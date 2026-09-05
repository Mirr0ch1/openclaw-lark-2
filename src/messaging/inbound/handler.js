"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Inbound message handling pipeline for the Lark/Feishu channel plugin.
 *
 * Orchestrates a nine-stage pipeline:
 *   1. Account resolution
 *   2. Event parsing         → parse.ts (merge_forward expanded in-place)
 *   3. Empty-message guard   → early return for text-less, media-less messages
 *   4. Sender enrichment     → enrich.ts (lightweight, before gate)
 *   5. Policy gate           → gate.ts
 *   6. User name prefetch    → enrich.ts (batch cache warm-up)
 *   7. Content resolution    → enrich.ts (media / quote, parallel)
 *   8. Command authorization → plugin-sdk/command-auth
 *   9. Agent dispatch        → dispatch.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFeishuMessage = handleFeishuMessage;
const reply_history_1 = require("openclaw/plugin-sdk/reply-history");
const command_auth_1 = require("openclaw/plugin-sdk/command-auth");
const allow_from_1 = require("openclaw/plugin-sdk/allow-from");
const accounts_1 = require("../../core/accounts.js");
const lark_client_1 = require("../../core/lark-client.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const lark_ticket_1 = require("../../core/lark-ticket.js");
const chat_queue_1 = require("../../channel/chat-queue.js");
const send_1 = require("../outbound/send.js");
const parse_1 = require("./parse.js");
const enrich_1 = require("./enrich.js");
const gate_1 = require("./gate.js");
const handler_registry_1 = require("./handler-registry.js");
const dispatch_1 = require("./dispatch.js");
const policy_1 = require("./policy.js");
const mention_registry_1 = require("./mention-registry.js");
const bot_loop_guard_1 = require("./bot-loop-guard.js");
const logger = (0, lark_logger_1.larkLogger)('inbound/handler');
// ---------------------------------------------------------------------------
// Public: handle inbound message
// ---------------------------------------------------------------------------
async function handleFeishuMessage(params) {
    const { cfg, event, botOpenId, runtime, chatHistories, accountId, replyToMessageId, forceMention, cardActionGate, skipTyping, } = params;
    // 1. Account resolution
    const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
    const accountFeishuCfg = account.config;
    // ★ 多账号配置隔离：构造 account 级别的 ClawdbotConfig
    //
    //   在多账号场景下，每个 account 可以独立配置 groupPolicy / requireMention
    //   等策略。但 SDK 的 resolveGroupPolicy / resolveRequireMention 等函数从
    //   cfg.channels.feishu 读取配置，而 cfg 是顶层全局配置，不包含 per-account
    //   的覆盖值。
    //
    //   这里将 cfg.channels.feishu 替换为经过 getLarkAccount() 合并后的
    //   accountFeishuCfg（= base config + account override），确保下游所有 SDK 调用
    //   都能正确读取当前 account 的配置。
    const accountScopedCfg = {
        ...cfg,
        channels: { ...cfg.channels, feishu: accountFeishuCfg },
    };
    const log = runtime?.log ?? ((...args) => logger.info(args.map(String).join(' ')));
    const error = runtime?.error ?? ((...args) => logger.error(args.map(String).join(' ')));
    // 2. Parse event → MessageContext (merge_forward expanded in-place)
    let ctx = await (0, parse_1.parseMessageEvent)(event, botOpenId, {
        cfg: accountScopedCfg,
        accountId: account.accountId,
    });
    // Self-echo hard filter — drop messages authored by this very bot before
    // enrichment, gating, or dispatch. Mirrors the channel-layer filter in
    // event-handlers.ts so alternate entrypoints into handleFeishuMessage
    // (synthetic messages, replays, tests) don't bypass it. Skipped when
    // botOpenId is not yet populated (startup race before bot probe resolves);
    // the channel-layer filter and downstream bot-sender gate act as fallback.
    if (botOpenId && ctx.senderId && ctx.senderId === botOpenId) {
        log(`feishu[${account.accountId}]: drop self-echo message ${ctx.messageId}`);
        return;
    }
    // 3. Early reject: skip empty-text messages with no media resources.
    //    OpenClaw 2026.4.29 adds a core-side guard for this (##74634), but
    //    rejecting here avoids wasting cycles on enrichment, gate, and
    //    dispatch for messages that would be silently dropped at the deliver
    //    callback anyway.
    //    A "bare @" (only a mention, no text/media) is a valid ping in
    //    bot-at-bot flows — treat it as an intentional wake-up rather than an
    //    empty message. Only drop messages that carry no text, no media, AND
    //    no mention at all.
    if (!ctx.content.trim() && ctx.resources.length === 0 && ctx.mentions.length === 0 && !ctx.mentionAll) {
        log(`feishu[${account.accountId}]: empty message ${ctx.messageId} (no text, no media, no mention), skipping`);
        return;
    }
    // 4. Enrich (lightweight): sender name + permission error tracking
    const { ctx: enrichedCtx, permissionError } = await (0, enrich_1.resolveSenderInfo)({
        ctx,
        account,
        log,
    });
    ctx = enrichedCtx;
    // Feed the per-chat name→openId registry that the outbound layer uses to
    // turn "@Name" in LLM output into a real <at user_id="ou_xxx"> element.
    // Both the sender and any @-target observed here are valuable signal —
    // recording them now (before the gate) means we keep learning names even
    // for messages the gate rejects.
    if (ctx.senderId && ctx.senderName) {
        (0, mention_registry_1.recordSender)(ctx.chatId, ctx.senderId, ctx.senderName);
    }
    for (const m of ctx.mentions) {
        if (m.openId && m.name)
            (0, mention_registry_1.recordMention)(ctx.chatId, m.openId, m.name);
    }
    // Bot-loop guard: a human turn re-arms the consecutive bot-turn budget so a
    // fresh human-driven exchange always starts clean (counter checked below,
    // after the gate, only for bot senders).
    if (!ctx.senderIsBot) {
        (0, bot_loop_guard_1.resetBotLoop)(ctx.chatId, ctx.threadId ?? ctx.rootId);
    }
    log(`feishu[${account.accountId}]: received message from ${ctx.senderId} in ${ctx.chatId} (${ctx.chatType})`);
    logger.info(`received from ${ctx.senderId} in ${ctx.chatId} (${ctx.chatType})`);
    const historyLimit = Math.max(0, accountFeishuCfg?.historyLimit ?? accountScopedCfg.messages?.groupChat?.historyLimit ?? reply_history_1.DEFAULT_GROUP_HISTORY_LIMIT);
    // 5. Gate: policy / access-control checks (skipped for synthetic messages).
    //    cardActionGate runs the real gate with the mention requirement treated as
    //    satisfied (the click is an implicit mention) — it takes precedence over
    //    forceMention so card actions are still subject to group/DM admission and
    //    sender allowlists.
    const gate = forceMention && !cardActionGate
        ? { allowed: true }
        : await (0, gate_1.checkMessageGate)({
            ctx,
            accountFeishuCfg,
            account,
            accountScopedCfg,
            log,
            mentionSatisfied: cardActionGate,
        });
    if (!gate.allowed) {
        if (gate.reason === 'no_mention') {
            logger.info(`rejected: no bot mention in group ${ctx.chatId}`);
        }
        // Record history entry if the gate produced one (group no-mention case)
        if (gate.historyEntry && chatHistories) {
            const historyKey = (0, chat_queue_1.threadScopedKey)(ctx.chatId, ctx.threadId);
            (0, reply_history_1.recordPendingHistoryEntryIfEnabled)({
                historyMap: chatHistories,
                historyKey,
                limit: historyLimit,
                entry: gate.historyEntry,
            });
        }
        return;
    }
    // 6. Batch pre-warm user name cache (sender + mentions)
    await (0, enrich_1.prefetchUserNames)({ ctx, account, log });
    // 7. Enrich (heavyweight, after gate — parallel where possible)
    const enrichParams = { ctx, accountScopedCfg, account, log };
    const [mediaResult, quotedContent] = await Promise.all([
        (0, enrich_1.resolveMedia)(enrichParams),
        (0, enrich_1.resolveQuotedContent)(enrichParams),
    ]);
    // 7b. Replace Feishu file-key placeholders in content with local
    //     file paths so the SDK can detect images for native vision and
    //     the AI receives meaningful file references.
    if (mediaResult.mediaList.length > 0) {
        ctx = {
            ...ctx,
            content: (0, enrich_1.substituteMediaPaths)(ctx.content, mediaResult.mediaList),
        };
    }
    // 8. Compute commandAuthorized via SDK access group command gating
    const core = lark_client_1.LarkClient.runtime;
    const isGroup = ctx.chatType === 'group';
    const dmPolicy = accountFeishuCfg?.dmPolicy ?? 'pairing';
    // Resolve per-group config early — shared by both command authorization
    // and dispatch (step 8).
    const groupConfig = isGroup ? (0, policy_1.resolveFeishuGroupConfig)({ cfg: accountFeishuCfg, groupId: ctx.chatId }) : undefined;
    const defaultGroupConfig = isGroup ? accountFeishuCfg?.groups?.['*'] : undefined;
    // Build the sender allowlist for command authorization in group context.
    // Excludes legacy oc_xxx chat-id entries (group admission, not sender identity).
    //
    // When the explicit group sender policy is "open", pass ["*"] to align
    // command authorization with chat access (if you can chat, you can run
    // commands).  When no policy is configured (undefined fallback), default to
    // allowlist behaviour — only users in accountFeishuCfg.allowFrom (owner list) or
    // an explicit groupAllowFrom/per-group allowFrom can run commands.
    const configuredGroupAllowFrom = (() => {
        if (!isGroup)
            return undefined;
        // Exclude legacy oc_xxx chat-id entries from groupAllowFrom (sender filter only).
        const { senderAllowFrom } = (0, policy_1.splitLegacyGroupAllowFrom)(accountFeishuCfg?.groupAllowFrom ?? []);
        const senderGroupAllowFrom = senderAllowFrom;
        const perGroupAllowFrom = (groupConfig?.allowFrom ?? []).map(String);
        const defaultSenderAllowFrom = !groupConfig && defaultGroupConfig?.allowFrom ? defaultGroupConfig.allowFrom.map(String) : [];
        const combined = [...senderGroupAllowFrom, ...perGroupAllowFrom, ...defaultSenderAllowFrom];
        if (combined.length > 0)
            return combined;
        // No allowFrom list configured — check if sender policy is explicitly "open".
        // Do NOT fall back to "open" as a default: unset policy → allowlist behaviour.
        const explicitSenderPolicy = groupConfig?.groupPolicy ?? defaultGroupConfig?.groupPolicy ?? accountFeishuCfg?.groupPolicy;
        return explicitSenderPolicy === 'open' ? ['*'] : [];
    })();
    const { commandAuthorized } = await (0, command_auth_1.resolveSenderCommandAuthorization)({
        rawBody: ctx.content,
        cfg: accountScopedCfg,
        isGroup,
        dmPolicy,
        configuredAllowFrom: (accountFeishuCfg?.allowFrom ?? []).map(String),
        configuredGroupAllowFrom,
        senderId: ctx.senderId,
        isSenderAllowed: (senderId, allowFrom) => (0, allow_from_1.isNormalizedSenderAllowed)({ senderId, allowFrom }),
        readAllowFromStore: () => (0, gate_1.readFeishuAllowFromStore)(account.accountId),
        shouldComputeCommandAuthorized: core.channel.commands.shouldComputeCommandAuthorized,
        resolveCommandAuthorizedFromAuthorizers: core.channel.commands.resolveCommandAuthorizedFromAuthorizers,
    });
    // Bot-loop guard: cap consecutive bot↔bot turns so a runaway debate stops
    // itself. Only bot senders count; a human turn already reset the counter
    // above. Checked after the gate so only messages we would actually act on
    // are counted.
    if (ctx.senderIsBot) {
        // Use root_id when thread_id is absent: in topic groups, reply events
        // often carry only root_id (thread_id is inferred later in dispatch), and
        // the queue/dispatch key uses the same fallback. Without it, all topics in
        // a chat share one chat-level counter and one topic's cutoff suppresses
        // the others.
        const verdict = (0, bot_loop_guard_1.noteBotTurnAndCheck)(ctx.chatId, ctx.threadId ?? ctx.rootId);
        if (!verdict.allowed) {
            log(`feishu[${account.accountId}]: bot-loop guard tripped ` +
                `(${verdict.count}/${verdict.limit} consecutive bot turns) in ${ctx.chatId}, suppressing reply`);
            // Surface the cutoff to humans ONCE, on the first over-cap turn, so the
            // conversation doesn't just go silent. Plain text with no @ — so it
            // neither wakes the peer bot (allowBots='mentions') nor extends the
            // loop. A human message resets the counter and re-arms auto-reply.
            //
            // Deliver it where the debate actually is: reply to the triggering
            // message. Thread the notice only when the bot↔bot reply body would also
            // be threaded — i.e. mirror resolveFeishuReplyRouting's effective
            // replyInThread for a bot turn: a real thread_id is present AND threading
            // is opted in (threadSession or replyInThread). Crucially we must NOT
            // treat root_id as a thread here: a plain bot↔bot quote-reply chain in a
            // normal group carries root_id but no thread_id, and reply_in_thread=true
            // on such a message makes Feishu mint a brand-new topic for just the
            // notice — pulling it into a thread the debate itself was never in.
            if (verdict.count === verdict.limit + 1) {
                try {
                    // Localized via i18nTexts so the viewer's Feishu client renders the
                    // notice in its own language (same mechanism as /help, /doctor).
                    // replyInThread precedence matches dispatch (group > default > account).
                    const replyInThreadCfg = groupConfig?.replyInThread ??
                        defaultGroupConfig?.replyInThread ??
                        account.config?.replyInThread;
                    const inThread = Boolean(ctx.threadId) &&
                        (account.config?.threadSession === true || replyInThreadCfg === true);
                    await (0, send_1.sendMessageFeishu)({
                        cfg: accountScopedCfg,
                        to: ctx.chatId,
                        text: `⏸️ 已达连续 ${verdict.limit} 轮自动对话上限，已暂停自动回复。需要继续请在群里发一条消息。`,
                        i18nTexts: {
                            zh_cn: `⏸️ 已达连续 ${verdict.limit} 轮自动对话上限，已暂停自动回复。需要继续请在群里发一条消息。`,
                            en_us: `⏸️ Reached the limit of ${verdict.limit} consecutive automated turns; auto-replies are paused. Send a message in the chat to continue.`,
                        },
                        accountId: account.accountId,
                        replyToMessageId: replyToMessageId ?? ctx.messageId,
                        replyInThread: inThread,
                        threadId: inThread ? ctx.threadId : undefined,
                    });
                }
                catch (err) {
                    log(`feishu[${account.accountId}]: failed to send loop-guard notice: ${String(err)}`);
                }
            }
            return;
        }
    }
    // 9. Dispatch to agent
    // groupConfig and defaultGroupConfig are already resolved above.
    try {
        await (0, dispatch_1.dispatchToAgent)({
            ctx,
            permissionError,
            mediaPayload: mediaResult.payload,
            quotedContent,
            account,
            accountScopedCfg,
            cfg,
            runtime,
            chatHistories,
            historyLimit,
            replyToMessageId,
            commandAuthorized,
            groupConfig,
            defaultGroupConfig,
            skipTyping,
            botOpenId,
        });
    }
    catch (err) {
        error(`feishu[${account.accountId}]: failed to dispatch message: ${String(err)}\nSTACK: ${err?.stack ?? 'no-stack'}`);
        logger.error(`dispatch failed: ${String(err)} (elapsed=${(0, lark_ticket_1.ticketElapsed)()}ms)`);
    }
}
(0, handler_registry_1.injectInboundHandler)(handleFeishuMessage);
