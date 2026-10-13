"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * WebSocket monitoring for the Lark/Feishu channel plugin.
 *
 * Manages per-account WSClient connections and routes inbound Feishu
 * events (messages, bot membership changes, read receipts) to the
 * appropriate handlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorFeishuProvider = monitorFeishuProvider;
const accounts_1 = require("../core/accounts.js");
const lark_client_1 = require("../core/lark-client.js");
const lark_logger_1 = require("../core/lark-logger.js");
const shutdown_hooks_1 = require("../core/shutdown-hooks.js");
const dedup_1 = require("../messaging/inbound/dedup.js");
const event_handlers_1 = require("./event-handlers.js");
const webhook_1 = require("./webhook.js");
const ingress_1 = require("./ingress.js");
const mlog = (0, lark_logger_1.larkLogger)('channel/monitor');
// ---------------------------------------------------------------------------
// Single-account monitor
// ---------------------------------------------------------------------------
/**
 * Start monitoring a single Feishu account.
 *
 * Creates a LarkClient, probes bot identity, registers event handlers,
 * and starts a WebSocket connection. Returns a Promise that resolves
 * when the abort signal fires (or immediately if already aborted).
 */
async function monitorSingleAccount(params) {
    const { account, runtime, abortSignal } = params;
    const { accountId } = account;
    const log = runtime?.log ?? ((...args) => mlog.info(args.map(String).join(' ')));
    const error = runtime?.error ?? ((...args) => mlog.error(args.map(String).join(' ')));
    const connectionMode = account.config.connectionMode ?? 'websocket';
    // Message dedup — filters duplicate deliveries from WebSocket reconnects.
    const dedupCfg = account.config.dedup;
    const messageDedup = new dedup_1.MessageDedup({
        ttlMs: dedupCfg?.ttlMs,
        maxEntries: dedupCfg?.maxEntries,
    });
    log(`feishu[${accountId}]: message dedup enabled (ttl=${messageDedup['ttlMs']}ms, max=${messageDedup['maxEntries']})`);
    // Create LarkClient instance — manages SDK client, WS, and bot identity.
    const lark = lark_client_1.LarkClient.fromAccount(account);
    // Attach dedup instance so it is disposed together with the client.
    lark.messageDedup = messageDedup;
    /** Per-chat history maps (used for group-chat context window). */
    const chatHistories = new Map();
    const ctx = {
        get cfg() {
            return lark_client_1.LarkClient.runtime.config.current();
        },
        lark,
        accountId,
        chatHistories,
        messageDedup,
        runtime,
        log,
        error,
    };
    const handlers = buildFeishuEventHandlers(ctx);
    if (connectionMode === 'webhook') {
        // Webhook transport still needs bot identity for mention gating.
        await lark.probe();
        log(`feishu[${accountId}]: bot open_id resolved: ${lark.botOpenId ?? 'unknown'}`);
        await (0, webhook_1.monitorFeishuWebhook)({ account, accountId, runtime, abortSignal, handlers, log });
        return;
    }
    log(`feishu[${accountId}]: starting WebSocket connection...`);
    // Durable admission is opt-in (`durableIngress: true`): recognised event
    // types go through the host ingress queue, everything else (incl. card
    // actions) still dispatches directly. Default off = unchanged behavior.
    let wsIngress = null;
    const wrapInvoke = account.config.durableIngress === true
        ? (base) => {
            const ingress = (0, ingress_1.createFeishuDurableIngress)({
                accountId,
                runtime,
                dispatcher: base,
                log: (message) => log(message),
            });
            if (!ingress) {
                log(`feishu[${accountId}]: durableIngress requested but the host exposes no ingress queue; using direct dispatch`);
                return base.invoke;
            }
            ingress.start();
            wsIngress = ingress;
            return (data, params) => ingress.invoke(data, params);
        }
        : undefined;
    try {
        await lark.startWS({ handlers, abortSignal, wrapInvoke });
    }
    finally {
        // Stop the ingress even if the socket failed to start, so its poll
        // loop does not outlive the account.
        await wsIngress?.stop();
    }
    // startWS resolves when abortSignal fires — probe result is logged inside startWS.
    log(`feishu[${accountId}]: bot open_id resolved: ${lark.botOpenId ?? 'unknown'}`);
    log(`feishu[${accountId}]: WebSocket client started`);
    mlog.info(`websocket started for account ${accountId}`);
}
/**
 * Build the Feishu event → handler map shared by both transports
 * (WebSocket EventDispatcher and the webhook route).
 */
function buildFeishuEventHandlers(ctx) {
    return {
        'im.message.receive_v1': (data) => (0, event_handlers_1.handleMessageEvent)(ctx, data),
        'im.message.message_read_v1': async () => { },
        'im.message.reaction.created_v1': (data) => (0, event_handlers_1.handleReactionEvent)(ctx, data),
        // These events are expected in normal usage but do not affect the
        // plugin's current behavior. Register no-op handlers to avoid SDK
        // warnings about missing handlers.
        'im.message.reaction.deleted_v1': async () => { },
        'im.chat.access_event.bot_p2p_chat_entered_v1': async () => { },
        'im.chat.member.bot.added_v1': (data) => (0, event_handlers_1.handleBotMembershipEvent)(ctx, data, 'added'),
        'im.chat.member.bot.deleted_v1': (data) => (0, event_handlers_1.handleBotMembershipEvent)(ctx, data, 'removed'),
        'vc.bot.meeting_invited_v1': (data) => (0, event_handlers_1.handleVcMeetingInvitedEvent)(ctx, data),
        // Drive comment event — fires when a user adds a comment or reply on a document.
        'drive.notice.comment_add_v1': (data) => (0, event_handlers_1.handleCommentEvent)(ctx, data),
        // 飞书 SDK EventDispatcher.register 不支持带返回值的处理器，此处是 SDK 类型限制的变通。
        'card.action.trigger': ((data) => (0, event_handlers_1.handleCardActionEvent)(ctx, data)),
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Start monitoring for all enabled Feishu accounts (or a single
 * account when `opts.accountId` is specified).
 */
async function monitorFeishuProvider(opts = {}) {
    const cfg = opts.config;
    if (!cfg) {
        throw new Error('Config is required for Feishu monitor');
    }
    // Store the original global config so plugin commands (doctor, diagnose)
    // can access cross-account information even when running inside an
    // account-scoped config context.
    lark_client_1.LarkClient.setGlobalConfig(cfg);
    const log = opts.runtime?.log ?? ((...args) => mlog.info(args.map(String).join(' ')));
    // Single-account mode.
    if (opts.accountId) {
        const account = (0, accounts_1.getLarkAccount)(cfg, opts.accountId);
        if (!account.enabled || !account.configured) {
            throw new Error(`Feishu account "${opts.accountId}" not configured or disabled`);
        }
        await monitorSingleAccount({
            cfg,
            account,
            runtime: opts.runtime,
            abortSignal: opts.abortSignal,
        });
        await (0, shutdown_hooks_1.drainShutdownHooks)({ log });
        return;
    }
    // Multi-account mode: start all enabled accounts in parallel.
    const accounts = (0, accounts_1.getEnabledLarkAccounts)(cfg);
    if (accounts.length === 0) {
        throw new Error('No enabled Feishu accounts configured');
    }
    log(`feishu: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(', ')}`);
    await Promise.all(accounts.map((account) => monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
    })));
    await (0, shutdown_hooks_1.drainShutdownHooks)({ log });
}
