"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Agent dispatch for inbound Feishu messages.
 *
 * Builds the agent envelope, prepends chat history context, and
 * dispatches through the appropriate reply path (system command
 * vs. normal streaming/static flow).
 *
 * Implementation details are split across focused modules:
 * - dispatch-context.ts  — DispatchContext type, route/session/event
 * - dispatch-builders.ts — pure payload/body/envelope construction
 * - dispatch-commands.ts — system command & permission notification
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchToAgent = dispatchToAgent;
const reply_history_1 = require("openclaw/plugin-sdk/reply-history");
const lark_logger_1 = require("../../core/lark-logger.js");
const lark_ticket_1 = require("../../core/lark-ticket.js");
const reply_dispatcher_1 = require("../../card/reply-dispatcher.js");
const chat_queue_1 = require("../../channel/chat-queue.js");
const tool_use_config_1 = require("../../card/tool-use-config.js");
const tool_use_trace_store_1 = require("../../card/tool-use-trace-store.js");
const abort_detect_1 = require("../../channel/abort-detect.js");
const bot_peer_context_1 = require("../outbound/bot-peer-context.js");
const comment_target_1 = require("../../core/comment-target.js");
const synthetic_target_1 = require("../../core/synthetic-target.js");
const targets_1 = require("../../core/targets.js");
const deliver_1 = require("../outbound/deliver.js");
const doctor_1 = require("../../commands/doctor.js");
const auth_1 = require("../../commands/auth.js");
const index_1 = require("../../commands/index.js");
const send_1 = require("../outbound/send.js");
const bot_content_1 = require("./bot-content.js");
const dispatch_commands_1 = require("./dispatch-commands.js");
const dispatch_builders_1 = require("./dispatch-builders.js");
const sentinel_store_1 = require("./sentinel-store.js");
const dispatch_context_1 = require("./dispatch-context.js");
const mention_1 = require("./mention.js");
const gate_1 = require("./gate.js");
const log = (0, lark_logger_1.larkLogger)('inbound/dispatch');
// ---------------------------------------------------------------------------
// Internal: normal message dispatch
// ---------------------------------------------------------------------------
/**
 * Dispatch a normal (non-command) message via the streaming card flow.
 * Cleans up consumed history entries after dispatch completes.
 *
 * Note: history cleanup is intentionally placed here and NOT in the
 * system-command path — command handlers don't consume history context,
 * so the entries should be preserved for the next normal message.
 */
/**
 * Dispatch a comment-target message via the buffered block dispatcher.
 *
 * Comment targets cannot use the streaming card flow (IM APIs don't
 * understand comment:... targets). Instead we use the SDK's buffered
 * block dispatcher with a deliver callback that sends via the Drive
 * comment reply API.
 */
async function dispatchCommentMessage(dc, ctxPayload, skillFilter) {
    const effectiveSessionKey = dc.threadSessionKey ?? dc.route.sessionKey;
    dc.log(`feishu[${dc.account.accountId}]: dispatching comment reply (session=${effectiveSessionKey})`);
    log.info(`dispatching comment reply (session=${effectiveSessionKey})`);
    let delivered = false;
    await dc.core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: dc.globalConfig,
        dispatcherOptions: {
            deliver: async (payload) => {
                const text = payload.text?.trim() ?? '';
                if (!text || text === 'NO_REPLY')
                    return;
                await (0, deliver_1.sendCommentReplyLark)({
                    cfg: dc.accountScopedCfg,
                    to: dc.ctx.chatId,
                    text,
                    accountId: dc.account.accountId,
                });
                delivered = true;
            },
            onSkip: (_payload, info) => {
                if (info.reason !== 'silent') {
                    dc.log(`feishu[${dc.account.accountId}]: comment reply skipped (reason=${info.reason})`);
                }
            },
            onError: (err, info) => {
                dc.error(`feishu[${dc.account.accountId}]: comment ${info.kind} reply failed: ${String(err)}`);
            },
        },
        replyOptions: {
            ...(skillFilter ? { skillFilter } : {}),
        },
    });
    dc.log(`feishu[${dc.account.accountId}]: comment dispatch complete (delivered=${delivered})`);
    log.info(`comment dispatch complete (delivered=${delivered}, elapsed=${(0, lark_ticket_1.ticketElapsed)()}ms)`);
}
/**
 * Dispatch a synthetic-target message via the buffered block dispatcher
 * while discarding every delivered payload.
 *
 * Synthetic contexts (e.g. VC meeting-invited) trigger the agent for its
 * side-effects (tool calls) — they do not correspond to a real IM chat,
 * so any text / card the agent emits must be dropped instead of being
 * sent as a DM to whatever open_id happens to be in ctx.chatId.
 */
async function dispatchSyntheticMessage(dc, ctxPayload, skillFilter) {
    const effectiveSessionKey = dc.threadSessionKey ?? dc.route.sessionKey;
    const isVcSynthetic = dc.ctx.chatId === synthetic_target_1.SYNTHETIC_VC_CHAT_ID;
    let deliveredFinalToSender = false;
    dc.log(`feishu[${dc.account.accountId}]: dispatching synthetic reply (session=${effectiveSessionKey}, target=${dc.ctx.chatId})`);
    log.info(`dispatching synthetic reply (session=${effectiveSessionKey})`);
    await dc.core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: dc.globalConfig,
        dispatcherOptions: {
            deliver: async (payload, info) => {
                const text = payload.text?.trim() ?? '';
                const preview = text.slice(0, 120);
                // VC invited flows intentionally keep the synthetic target to avoid
                // leaking intermediate tool output to IM, but the final business
                // result should be explicitly notified to the inviter.
                //
                // Important: this DM is only a transport bridge for the final text.
                // It does not rebind the inviter's DM conversation to the synthetic
                // meeting-scoped session; later DM replies will still be routed by the
                // normal OpenClaw DM session rules.
                if (isVcSynthetic && info.kind === 'final' && text && text !== 'NO_REPLY' && !deliveredFinalToSender) {
                    deliveredFinalToSender = true;
                    try {
                        await (0, send_1.sendMessageFeishu)({
                            cfg: dc.accountScopedCfg,
                            to: dc.ctx.senderId,
                            text,
                            accountId: dc.account.accountId,
                        });
                        dc.log(`feishu[${dc.account.accountId}]: synthetic VC final delivered explicitly to sender=${dc.ctx.senderId}, preview="${preview}"`);
                        return;
                    }
                    catch (err) {
                        deliveredFinalToSender = false;
                        dc.error(`feishu[${dc.account.accountId}]: synthetic VC final delivery failed to sender=${dc.ctx.senderId}: ${String(err)}`);
                    }
                }
                if (info.kind === 'final') {
                    dc.log(`feishu[${dc.account.accountId}]: synthetic final payload dropped (target=${dc.ctx.chatId})`);
                }
            },
            onSkip: (_payload, info) => {
                if (info.reason !== 'silent') {
                    dc.log(`feishu[${dc.account.accountId}]: synthetic reply skipped (reason=${info.reason})`);
                }
            },
            onError: (err, info) => {
                dc.error(`feishu[${dc.account.accountId}]: synthetic ${info.kind} reply failed: ${String(err)}`);
            },
        },
        replyOptions: {
            ...(skillFilter ? { skillFilter } : {}),
        },
    });
    dc.log(`feishu[${dc.account.accountId}]: synthetic dispatch complete (elapsed=${(0, lark_ticket_1.ticketElapsed)()}ms)`);
}
async function dispatchNormalMessage(dc, ctxPayload, routing, chatHistories, historyKey, historyLimit, replyToMessageId, skillFilter, skipTyping, botPeer) {
    // Synthetic targets (e.g. VC meeting-invited) have no real IM peer to
    // deliver replies to. Route them through the buffered block dispatcher
    // with a deliver() that drops every payload — the agent still runs
    // (tool calls, side-effects) but produces no outbound IM traffic.
    if ((0, synthetic_target_1.isSyntheticTarget)(dc.ctx.chatId)) {
        await dispatchSyntheticMessage(dc, ctxPayload, skillFilter);
        return;
    }
    // Comment targets bypass the streaming card / IM flow entirely —
    // route through the Drive comment reply API.
    if ((0, comment_target_1.isCommentTarget)(dc.ctx.chatId)) {
        await dispatchCommentMessage(dc, ctxPayload, skillFilter);
        return;
    }
    // Abort messages should never create streaming cards — dispatch via the
    // plain-text system-command path so the SDK's abort handler can reply
    // without touching CardKit.
    if ((0, abort_detect_1.isLikelyAbortText)(dc.ctx.content?.trim() ?? '')) {
        dc.log(`feishu[${dc.account.accountId}]: abort message detected, using plain-text dispatch`);
        log.info('abort message detected, using plain-text dispatch');
        await (0, dispatch_commands_1.dispatchSystemCommand)(dc, ctxPayload, replyToMessageId);
        return;
    }
    const effectiveSessionKey = dc.threadSessionKey ?? dc.route.sessionKey;
    const toolUseDisplay = (0, tool_use_config_1.resolveToolUseDisplayConfig)({
        cfg: dc.accountScopedCfg,
        feishuCfg: dc.account.config,
        agentId: dc.route.agentId,
        sessionKey: effectiveSessionKey,
        body: dc.ctx.content,
    });
    if (toolUseDisplay.showToolUse) {
        (0, tool_use_trace_store_1.startToolUseTraceRun)(effectiveSessionKey);
    }
    else {
        (0, tool_use_trace_store_1.clearToolUseTraceRun)(effectiveSessionKey);
    }
    const { dispatcher, replyOptions, markDispatchIdle, markFullyComplete, abortCard } = (0, reply_dispatcher_1.createFeishuReplyDispatcher)({
        cfg: dc.accountScopedCfg,
        agentId: dc.route.agentId,
        chatId: dc.ctx.chatId,
        sessionKey: effectiveSessionKey,
        replyToMessageId: replyToMessageId ?? dc.ctx.messageId,
        accountId: dc.account.accountId,
        chatType: dc.ctx.chatType,
        skipTyping,
        replyInThread: routing.replyInThread,
        threadId: routing.threadId,
        toolUseDisplay,
        senderOpenId: dc.ctx.senderId,
    });
    // Create an AbortController so the abort fast-path can cancel the
    // underlying LLM request (not just the streaming card UI).
    const abortController = new AbortController();
    // Register the active dispatcher so the monitor abort fast-path can
    // terminate the streaming card before this task completes.
    const queueKey = (0, chat_queue_1.buildQueueKey)(dc.account.accountId, dc.ctx.chatId, dc.ctx.threadId);
    (0, chat_queue_1.registerActiveDispatcher)(queueKey, { abortCard, abortController });
    dc.log(`feishu[${dc.account.accountId}]: dispatching to agent (session=${effectiveSessionKey})`);
    log.info(`dispatching to agent (session=${effectiveSessionKey})`);
    // Attach the resolved bot-peer (if any) so the outbound `ensureMention`
    // backstop can guarantee an @ even when the LLM forgets. Resolved by the
    // caller (dispatchToAgent) and decoupled from thread routing. Undefined →
    // pure no-op.
    const withBotPeer = botPeer
        ? (fn) => (0, bot_peer_context_1.runWithBotPeerContext)(botPeer, fn)
        : (fn) => fn();
    try {
        const { queuedFinal, counts } = await withBotPeer(() => dc.core.channel.reply.dispatchReplyFromConfig({
            ctx: ctxPayload,
            cfg: dc.globalConfig,
            dispatcher,
            replyOptions: {
                ...replyOptions,
                abortSignal: abortController.signal,
                ...(skillFilter ? { skillFilter } : {}),
            },
            usePublishedModelRuntime: true,
        }));
        // Wait for all enqueued deliver() calls in the SDK's sendChain to
        // complete before marking the dispatch as done.  Without this,
        // dispatchReplyFromConfig() may return while the final deliver() is
        // still pending in the Promise chain, causing markFullyComplete() to
        // block it and leaving completedText incomplete — which in turn makes
        // the streaming card's final update show truncated content.
        //
        // Run under withBotPeer too so any deliveries flushed during waitForIdle
        // still see the peer context.
        await withBotPeer(() => dispatcher.waitForIdle());
        markFullyComplete();
        markDispatchIdle();
        // Clean up consumed history entries
        if (dc.isGroup && historyKey && chatHistories) {
            (0, reply_history_1.clearHistoryEntriesIfEnabled)({
                historyMap: chatHistories,
                historyKey,
                limit: historyLimit,
            });
        }
        dc.log(`feishu[${dc.account.accountId}]: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
        log.info(`dispatch complete (replies=${counts.final}, elapsed=${(0, lark_ticket_1.ticketElapsed)()}ms)`);
    }
    finally {
        (0, chat_queue_1.unregisterActiveDispatcher)(queueKey);
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function dispatchToAgent(params) {
    // 1. Derive shared context (including route resolution + system event)
    const dc = (0, dispatch_context_1.buildDispatchContext)(params);
    // 1a. Reply routing: handles topic-group thread inference (may mutate dc)
    //     and bot-peer suppression for bot→bot group scenarios (#32980).
    //     See src/messaging/inbound/bot-content.ts for the full rationale.
    const replyInThreadConfig = params.groupConfig?.replyInThread ??
        params.defaultGroupConfig?.replyInThread ??
        dc.account.config?.replyInThread;
    const routing = await (0, bot_content_1.resolveFeishuReplyRouting)(dc, { replyInThreadConfig });
    // 1b. Resolve thread session isolation (async: may query group info API)
    if (dc.isThread && dc.ctx.threadId) {
        dc.threadSessionKey = await (0, dispatch_context_1.resolveThreadSessionKey)({
            accountScopedCfg: dc.accountScopedCfg,
            account: dc.account,
            chatId: dc.ctx.chatId,
            threadId: dc.ctx.threadId,
            baseSessionKey: dc.route.sessionKey,
        });
    }
    // Consume any pending mention sentinels for this thread. Take and
    // delete is one shot per inbound — capture once, hand to both body
    // builders below.
    const sentinelKey = (0, chat_queue_1.threadScopedKey)(dc.ctx.chatId, dc.isThread ? dc.ctx.threadId : undefined);
    const sentinels = (0, sentinel_store_1.getSentinelStore)(dc.account.accountId).consumeSentinels(sentinelKey);
    // 3. Build annotated message body
    const messageBody = (0, dispatch_builders_1.buildMessageBody)(params.ctx, params.quotedContent, sentinels);
    // 4. Permission-error notification (optional side-effect).
    //    Isolated so a failure here does not block the main message dispatch.
    //    Skipped for comment targets: the streaming card dispatcher inside
    //    dispatchPermissionNotification sends via IM APIs which don't
    //    understand comment:... targets.
    if (params.permissionError && !(0, comment_target_1.isCommentTarget)(dc.ctx.chatId)) {
        try {
            await (0, dispatch_commands_1.dispatchPermissionNotification)(dc, params.permissionError, params.replyToMessageId);
        }
        catch (err) {
            dc.error(`feishu[${dc.account.accountId}]: permission notification failed, continuing: ${String(err)}`);
        }
    }
    // 5. Build main envelope (with group chat history)
    const { combinedBody, historyKey } = (0, dispatch_builders_1.buildEnvelopeWithHistory)(dc, messageBody, params.chatHistories, params.historyLimit);
    // 6. Build BodyForAgent with mention annotation (if any).
    //    SDK >= 2026.2.10 no longer falls back to Body for BodyForAgent,
    //    so we must set it explicitly to preserve the annotation.
    const bodyForAgent = (0, dispatch_builders_1.buildBodyForAgent)(params.ctx, sentinels);
    // 7. Build InboundHistory for SDK metadata injection (>= 2026.2.10).
    //    The SDK's buildInboundUserContextPrefix renders these as structured
    //    JSON blocks; earlier SDK versions simply ignore unknown fields.
    const threadHistoryKey = (0, chat_queue_1.threadScopedKey)(dc.ctx.chatId, dc.isThread ? dc.ctx.threadId : undefined);
    const inboundHistory = dc.isGroup && params.chatHistories && params.historyLimit > 0
        ? (params.chatHistories.get(threadHistoryKey) ?? []).map((entry) => ({
            sender: entry.sender,
            body: entry.body,
            timestamp: entry.timestamp ?? Date.now(),
        }))
        : undefined;
    // 8. Build inbound context payload
    const isBareNewOrReset = /^\/(?:new|reset)\s*$/i.test((params.ctx.content ?? '').trim());
    const configuredGroupPrompt = dc.isGroup
        ? params.groupConfig?.systemPrompt?.trim() || params.defaultGroupConfig?.systemPrompt?.trim() || undefined
        : undefined;
    // In group chats, always inject bot-at-bot guidance (self open_id + @
    // delivery rules + loop hygiene), merged with any operator-configured
    // group prompt. Complements the deterministic ensureMention safety net.
    const groupSystemPrompt = dc.isGroup
        ? (0, dispatch_builders_1.buildFeishuGroupSystemPrompt)(configuredGroupPrompt, params.botOpenId)
        : undefined;
    const originatingTo = isBareNewOrReset && dc.isThread
        ? (0, targets_1.encodeFeishuRouteTarget)({
            target: dc.feishuTo,
            replyToMessageId: params.replyToMessageId ?? params.ctx.messageId,
            threadId: dc.ctx.threadId,
        })
        : undefined;
    const ctxPayload = (0, dispatch_builders_1.buildInboundPayload)(dc, {
        body: combinedBody,
        bodyForAgent,
        rawBody: params.ctx.content,
        commandBody: params.ctx.content,
        originatingTo,
        senderName: params.ctx.senderName ?? params.ctx.senderId,
        senderId: params.ctx.senderId,
        messageSid: params.ctx.messageId,
        wasMentioned: (0, mention_1.mentionedBot)(params.ctx) ||
            (params.ctx.mentionAll &&
                (0, gate_1.resolveRespondToMentionAll)({
                    groupConfig: params.groupConfig,
                    defaultConfig: params.defaultGroupConfig,
                    accountFeishuCfg: params.account.config,
                })),
        replyToBody: params.quotedContent,
        inboundHistory,
        extraFields: {
            ...params.mediaPayload,
            ...(params.extraInboundFields ?? {}),
            ...(0, dispatch_builders_1.buildFeishuIdentityFields)(params.ctx, params.botOpenId),
            ...(groupSystemPrompt ? { GroupSystemPrompt: groupSystemPrompt } : {}),
            ...(dc.ctx.threadId ? { MessageThreadId: dc.ctx.threadId } : {}),
        },
    });
    // 9a. Intercept /feishu commands for i18n multi-locale card dispatch
    //     Must run BEFORE the SDK command check — the SDK does not recognise
    //     plugin-registered commands via isControlCommandMessage, so
    //     /feishu_* falls through to the AI agent otherwise.
    //     Skipped for comment targets: comment text won't match /feishu_*
    //     patterns in practice, and sendCardFeishu/sendMessageFeishu can't
    //     deliver to comment:... targets.
    const contentTrimmed = (params.ctx.content ?? '').trim();
    const isCommentFlow = (0, comment_target_1.isCommentTarget)(dc.ctx.chatId);
    const isDoctorCommand = !isCommentFlow && /^\/feishu[_ ]doctor\s*$/i.test(contentTrimmed);
    const isAuthCommand = !isCommentFlow && /^\/feishu[_ ](?:auth|onboarding)\s*$/i.test(contentTrimmed);
    const isStartCommand = !isCommentFlow && /^\/feishu[_ ]start\s*$/i.test(contentTrimmed);
    const isHelpCommand = !isCommentFlow && /^\/feishu(?:[_ ]help)?\s*$/i.test(contentTrimmed);
    const i18nCommandName = isDoctorCommand
        ? 'doctor'
        : isAuthCommand
            ? 'auth'
            : isStartCommand
                ? 'start'
                : isHelpCommand
                    ? 'help'
                    : null;
    if (i18nCommandName) {
        dc.log(`feishu[${dc.account.accountId}]: ${i18nCommandName} command detected, using i18n dispatch`);
        log.info(`${i18nCommandName} command detected, using i18n dispatch`);
        try {
            let i18nTexts;
            if (isDoctorCommand) {
                i18nTexts = await (0, doctor_1.runFeishuDoctorI18n)(dc.accountScopedCfg, dc.account.accountId);
            }
            else if (isAuthCommand) {
                i18nTexts = await (0, auth_1.runFeishuAuthI18n)(dc.accountScopedCfg);
            }
            else if (isStartCommand) {
                i18nTexts = (0, index_1.runFeishuStartI18n)(dc.accountScopedCfg);
            }
            else {
                i18nTexts = (0, index_1.getFeishuHelpI18n)();
            }
            const card = (0, send_1.buildI18nMarkdownCard)(i18nTexts);
            await (0, send_1.sendCardFeishu)({
                cfg: dc.accountScopedCfg,
                to: dc.ctx.chatId,
                card,
                replyToMessageId: params.replyToMessageId ?? dc.ctx.messageId,
                accountId: dc.account.accountId,
                replyInThread: routing.replyInThread,
            });
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            dc.error(`feishu[${dc.account.accountId}]: ${i18nCommandName} i18n dispatch failed: ${errMsg}`);
            await (0, send_1.sendMessageFeishu)({
                cfg: dc.accountScopedCfg,
                to: dc.ctx.chatId,
                text: `${i18nCommandName} failed: ${errMsg}`,
                replyToMessageId: params.replyToMessageId ?? dc.ctx.messageId,
                accountId: dc.account.accountId,
                replyInThread: routing.replyInThread,
            });
        }
        return;
    }
    // 8. Dispatch: system command vs. normal message
    //    Comment targets always go to normal dispatch — system command
    //    delivery uses sendMessageFeishu which can't reach comment threads.
    const isCommand = !isCommentFlow &&
        dc.core.channel.commands.isControlCommandMessage(params.ctx.content, params.accountScopedCfg);
    // Resolve per-group skill filter (per-group > default "*")
    const skillFilter = dc.isGroup ? (params.groupConfig?.skills ?? params.defaultGroupConfig?.skills) : undefined;
    if (isCommand) {
        await (0, dispatch_commands_1.dispatchSystemCommand)(dc, ctxPayload, params.replyToMessageId);
        // /new and /reset explicitly start a new session — clear pending history
        if (isBareNewOrReset && dc.isGroup && historyKey && params.chatHistories) {
            (0, reply_history_1.clearHistoryEntriesIfEnabled)({
                historyMap: params.chatHistories,
                historyKey,
                limit: params.historyLimit,
            });
        }
    }
    else {
        // Normal message dispatch; history cleanup happens inside.
        // System commands intentionally skip history cleanup — command handlers
        // don't consume history context, so entries are preserved for the next
        // normal message.
        // A human asking the bots to stop ("中断对话", "stop talking", …) must NOT
        // get a forced peer-@: the deterministic ensureMention backstop would
        // re-wake the peer bot and defeat the interruption. Skip peer resolution
        // on stop-intent; the kickoff/continue path ("你们辩论") is unaffected.
        const botPeer = (0, abort_detect_1.isConversationStopIntent)(dc.ctx.content ?? '')
            ? undefined
            : (0, bot_content_1.resolveBotPeerForMention)({
                isGroup: dc.isGroup,
                senderIsBot: dc.ctx.senderIsBot,
                senderId: dc.ctx.senderId,
                senderName: dc.ctx.senderName ?? undefined,
                mentions: dc.ctx.mentions,
                botOpenId: params.botOpenId,
            });
        await dispatchNormalMessage(dc, ctxPayload, routing, params.chatHistories, historyKey, params.historyLimit, params.replyToMessageId, skillFilter, params.skipTyping, botPeer);
    }
}
