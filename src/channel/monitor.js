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
const thread_bindings_1 = require("../core/thread-bindings.js");
const channel_inbound_debounce_1 = require("openclaw/plugin-sdk/channel-inbound-debounce");
const dedup_1 = require("../messaging/inbound/dedup.js");
const debounce_1 = require("../messaging/inbound/debounce.js");
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
    // Persistent backend (SQLite) survives restarts; the memory-only fallback
    // is used when the host SDK lacks `persistent-dedupe`.
    const dedupCfg = account.config.dedup;
    const messageDedup = new dedup_1.MessageDedup({
        ttlMs: dedupCfg?.ttlMs,
        maxEntries: dedupCfg?.maxEntries,
    });
    // Warm persisted entries into memory before accepting traffic so a
    // redelivery racing startup is still caught across a gateway restart.
    try {
        const warmed = await messageDedup.warmup(accountId);
        if (warmed > 0) {
            log(`feishu[${accountId}]: warmed ${warmed} persisted dedupe entr${warmed === 1 ? 'y' : 'ies'}`);
        }
    }
    catch (err) {
        log(`feishu[${accountId}]: dedupe warmup failed, continuing memory-only: ${String(err)}`);
    }
    log(`feishu[${accountId}]: message dedup enabled (ttl=${messageDedup['ttlMs']}ms, max=${messageDedup['maxEntries']}, persistent=${messageDedup['persistent'] ? 'yes' : 'no'})`);
    // Create LarkClient instance — manages SDK client, WS, and bot identity.
    const lark = lark_client_1.LarkClient.fromAccount(account);
    // Attach dedup instance so it is disposed together with the client.
    lark.messageDedup = messageDedup;
    // Thread/conversation bindings — registers this account's session-binding
    // adapter with the host so a subagent/ACP conversation can bind to a Feishu
    // chat/topic. `null` on cores that lack the manager API (feature-detected).
    const threadBindings = (0, thread_bindings_1.createFeishuThreadBindingManager)({
        cfg: params.cfg,
        accountId,
    });
    if (!threadBindings) {
        log(`feishu[${accountId}]: thread bindings unavailable on this core (needs createAccountScopedConversationBindingManager)`);
    }
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
    // Inbound debounce (opt-in via core `messages.inbound.debounceMs`). When
    // enabled, rapid text messages from one sender/chat are merged into a single
    // turn. `resolveInboundDebounceMs` returns 0 when unset, so the debouncer is
    // not created and the direct path is used unchanged.
    let inboundDebounceMs = 0;
    try {
        inboundDebounceMs = (0, channel_inbound_debounce_1.resolveInboundDebounceMs)({
            cfg: params.cfg,
            channel: 'feishu',
        });
    }
    catch (err) {
        log(`feishu[${accountId}]: could not resolve inbound debounce config, disabling: ${String(err)}`);
    }
    if (inboundDebounceMs > 0) {
        ctx.inboundDebouncer = (0, debounce_1.createFeishuInboundDebouncer)({
            accountId,
            debounceMs: inboundDebounceMs,
            dispatch: (event, _dedupeKey, processingClaim, admissionLifecycle) => (0, event_handlers_1.dispatchFeishuMessage)(ctx, event, processingClaim, admissionLifecycle),
            getBotOpenId: () => lark.botOpenId,
            hasProcessed: (dedupeKey, namespace) => messageDedup.hasRecent(dedupeKey, namespace),
            isControlCommand: (text) => {
                try {
                    const commands = lark_client_1.LarkClient.runtime?.channel?.commands;
                    return typeof commands?.isControlCommandMessage === 'function'
                        ? Boolean(commands.isControlCommandMessage(text, params.cfg))
                        : false;
                }
                catch {
                    return false;
                }
            },
            log,
            error,
        });
        log(`feishu[${accountId}]: inbound debounce enabled (${inboundDebounceMs}ms)`);
    }
    const handlers = buildFeishuEventHandlers(ctx);
    if (connectionMode === 'webhook') {
        try {
            // Webhook transport still needs bot identity for mention gating.
            await lark.probe();
            log(`feishu[${accountId}]: bot open_id resolved: ${lark.botOpenId ?? 'unknown'}`);
            await (0, webhook_1.monitorFeishuWebhook)({ account, accountId, runtime, abortSignal, handlers, log });
        }
        finally {
            threadBindings?.stop();
        }
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
            // Let the message handler resolve the turn lifecycle for a durable
            // delivery (needed to defer settlement across a debounce flush).
            ctx.resolveIngressLifecycle = (data) => ingress.resolveLifecycle(data);
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
        threadBindings?.stop();
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
