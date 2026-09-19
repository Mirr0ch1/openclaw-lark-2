"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply dispatcher factory for the Lark/Feishu channel plugin.
 *
 * Thin factory function that:
 * 1. Resolves account, reply mode, and typing indicator config
 * 2. In streaming mode, delegates to StreamingCardController
 * 3. In static mode, delivers via sendMessageFeishu / sendMarkdownCardFeishu
 * 4. Assembles and returns FeishuReplyDispatcherResult
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFeishuReplyDispatcher = createFeishuReplyDispatcher;
const channel_runtime_1 = require("openclaw/plugin-sdk/channel-message");
const channel_feedback_1 = require("openclaw/plugin-sdk/channel-feedback");
const accounts_1 = require("../core/accounts.js");
const footer_config_1 = require("../core/footer-config.js");
const lark_client_1 = require("../core/lark-client.js");
const lark_logger_1 = require("../core/lark-logger.js");
const deliver_1 = require("../messaging/outbound/deliver.js");
const send_1 = require("../messaging/outbound/send.js");
const typing_1 = require("../messaging/outbound/typing.js");
const builder_1 = require("./builder.js");
const card_error_1 = require("./card-error.js");
const reply_mode_1 = require("./reply-mode.js");
const streaming_card_controller_1 = require("./streaming-card-controller.js");
const ask_user_gateway_card_1 = require("./ask-user-gateway-card.js");
const unavailable_guard_1 = require("./unavailable-guard.js");
const log = (0, lark_logger_1.larkLogger)('card/reply-dispatcher');
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function createFeishuReplyDispatcher(params) {
    const core = lark_client_1.LarkClient.runtime;
    const { cfg, agentId, chatId, sessionKey, replyToMessageId, accountId, replyInThread, threadId } = params;
    // Resolve account so we can read per-account config (e.g. replyMode)
    const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
    const feishuCfg = account.config;
    const prefixContext = (0, channel_runtime_1.createReplyPrefixContext)({ cfg, agentId });
    // ---- Reply mode resolution ----
    const chatType = params.chatType;
    const effectiveReplyMode = (0, reply_mode_1.resolveReplyMode)({ feishuCfg, chatType });
    const replyMode = (0, reply_mode_1.expandAutoMode)({
        mode: effectiveReplyMode,
        streaming: feishuCfg?.streaming,
        chatType,
    });
    const useStreamingCards = replyMode === 'streaming';
    // ---- Block streaming for static mode ----
    const enableBlockStreaming = feishuCfg?.blockStreaming === true && !useStreamingCards;
    const { toolUseDisplay } = params;
    const resolvedFooter = (0, footer_config_1.resolveFooterConfig)(feishuCfg?.footer);
    log.info('reply mode resolved', {
        effectiveReplyMode,
        replyMode,
        chatType,
    });
    log.info('footer config resolved', {
        accountId: account.accountId,
        sessionKey,
        chatType,
        useStreamingCards,
        rawFooter: feishuCfg?.footer ?? null,
        resolvedFooter,
    });
    // ---- Chunk & render settings (static mode only) ----
    const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, 'feishu', accountId, { fallbackLimit: 4000 });
    const chunkMode = core.channel.text.resolveChunkMode(cfg, 'feishu');
    // ---- Terminal plain-text fallback ----
    // The streaming card is the ONLY delivery vehicle in streaming mode. If the
    // terminal card update is rejected by Feishu (300305 >200 elements,
    // 200860 >30KB, expired streaming mode, …) the reply would be lost with the
    // user staring at a frozen card. The controller calls this hook to deliver
    // the answer as ordinary text instead.
    const deliverFallbackText = async (text) => {
        const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
        log.warn('delivering reply via plain-text fallback', {
            chunks: chunks.length,
            chatId,
        });
        for (const chunk of chunks) {
            await (0, send_1.sendMessageFeishu)({
                cfg,
                to: chatId,
                text: chunk,
                replyToMessageId,
                replyInThread,
                accountId,
                threadId,
            });
        }
    };
    // ---- Streaming card controller (instantiated only when needed) ----
    // 流式模式：完整流式卡片；静态模式（群聊）：仅工具活动卡（activityOnly），
    // 展示 agent 正在调用的工具，最终回复仍走静态 deliver()。
    const enableToolActivity = Boolean(toolUseDisplay?.showToolUse);
    const controller = useStreamingCards || enableToolActivity
        ? new streaming_card_controller_1.StreamingCardController({
            cfg,
            agentId,
            sessionKey,
            accountId,
            chatId,
            replyToMessageId,
            replyInThread,
            toolUseDisplay,
            resolvedFooter,
            activityOnly: !useStreamingCards,
            deliverFallbackText,
        })
        : null;
    // ---- Static mode unavailable guard ----
    // In streaming mode the controller owns its own guard; in static mode
    // we still need unavailable-message detection for typing and deliver.
    let staticAborted = false;
    const staticGuard = controller
        ? null
        : new unavailable_guard_1.UnavailableGuard({
            replyToMessageId,
            getCardMessageId: () => null,
            onTerminate: () => {
                staticAborted = true;
            },
        });
    const shouldSkip = (source) => {
        if (controller)
            return controller.shouldSkipForUnavailable(source);
        return staticGuard?.shouldSkip(source) ?? false;
    };
    const isTerminated = () => {
        if (controller)
            return controller.isTerminated;
        return staticGuard?.isTerminated ?? false;
    };
    // ---- Typing indicator (reaction-based) ----
    let typingState = null;
    let typingStopped = false;
    const typingCallbacks = (0, channel_runtime_1.createTypingCallbacks)({
        keepaliveIntervalMs: 0,
        start: async () => {
            if (shouldSkip('typing.start.precheck'))
                return;
            if (!replyToMessageId || typingStopped || params.skipTyping)
                return;
            if (typingState?.reactionId)
                return;
            typingState = await (0, typing_1.addTypingIndicator)({
                cfg,
                messageId: replyToMessageId,
                accountId,
            });
            if (shouldSkip('typing.start.postcheck'))
                return;
            if (typingStopped && typingState) {
                await (0, typing_1.removeTypingIndicator)({ cfg, state: typingState, accountId });
                typingState = null;
                log.info('removed typing indicator (raced with stop)');
                return;
            }
            log.info('added typing indicator reaction');
        },
        stop: async () => {
            typingStopped = true;
            if (!typingState)
                return;
            await (0, typing_1.removeTypingIndicator)({ cfg, state: typingState, accountId });
            typingState = null;
            log.info('removed typing indicator reaction');
        },
        onStartError: (err) => {
            (0, channel_feedback_1.logTypingFailure)({
                log: (message) => log.warn(message),
                channel: 'feishu',
                action: 'start',
                error: err,
            });
        },
        onStopError: (err) => {
            (0, channel_feedback_1.logTypingFailure)({
                log: (message) => log.warn(message),
                channel: 'feishu',
                action: 'stop',
                error: err,
            });
        },
    });
    // ---- dispatchFullyComplete flag (static mode) ----
    let dispatchFullyComplete = false;
    // ---- Build dispatcher ----
    const { dispatcher, replyOptions, markDispatchIdle } = core.channel.reply.createReplyDispatcherWithTyping({
        responsePrefix: prefixContext.responsePrefix,
        responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
        humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
        onReplyStart: async () => {
            if (shouldSkip('onReplyStart'))
                return;
            await typingCallbacks.onReplyStart?.();
        },
        deliver: async (payload, meta) => {
            log.debug('deliver called', {
                textPreview: payload.text?.slice(0, 100),
                kind: meta?.kind,
            });
            if (shouldSkip('deliver.entry'))
                return;
            // ---- Gateway ask_user question ----
            // Render the question as an interactive button card instead of the
            // plain text (which previously blocked the run with no way to answer).
            if ((0, ask_user_gateway_card_1.isAskUserPayload)(payload)) {
                const consumed = await (0, ask_user_gateway_card_1.deliverAskUserQuestion)({
                    cfg,
                    chatId,
                    replyToMessageId,
                    replyInThread,
                    accountId,
                    payload,
                    senderOpenId: params.senderOpenId,
                });
                if (consumed)
                    return;
            }
            // ---- Abort guard ----
            // Only check aborted (not isTerminalPhase) so that
            // creation_failed can still fallthrough to static delivery.
            if (staticAborted || controller?.isTerminated || controller?.isAborted) {
                log.debug('deliver: skipped (aborted)');
                return;
            }
            // ---- Post-dispatch guard ----
            if (dispatchFullyComplete) {
                log.debug('deliver: skipped (dispatch already complete)');
                return;
            }
            // 提取文本和媒体 URL
            const text = getVisiblePayloadText(payload);
            const reasoningText = payload.isReasoning === true ? (payload.text ?? '') : '';
            const payloadMediaUrls = payload.mediaUrls?.length
                ? payload.mediaUrls
                : payload.mediaUrl
                    ? [payload.mediaUrl]
                    : [];
            if (!text.trim() && !reasoningText.trim() && payloadMediaUrls.length === 0) {
                log.debug('deliver: empty text and no media, skipping');
                return;
            }
            // ---- Streaming card mode ----
            if (controller) {
                if (meta?.kind === 'tool' && shouldRouteToolPayloadToCard(payload, toolUseDisplay.showToolUse)) {
                    await controller.onToolPayload(payload);
                    return;
                }
                // 静态模式（activityOnly）：文本/推理由下方静态 deliver 发送，
                // 卡片仅用于展示工具活动，不能把最终回复吞进卡片。
                if (!controller.activityOnly) {
                    const controllerText = reasoningText.trim() ? reasoningText : text;
                    if (controllerText.trim()) {
                        await controller.ensureCardCreated();
                        if (controller.isTerminated)
                            return;
                        if (controller.cardMessageId) {
                            if (payload.isReasoning === true) {
                                await controller.onReasoningStream({ ...payload, text: controllerText });
                                return;
                            }
                            await controller.onDeliver({ ...payload, text: controllerText });
                            return;
                        }
                        // Card creation failed — fall through to static delivery
                        log.warn('deliver: card creation failed, falling back to static delivery');
                    }
                }
            }
            // ---- Static text delivery ----
            if (text.trim()) {
                if ((0, reply_mode_1.shouldUseCard)(text)) {
                    const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
                    log.info('deliver: sending card chunks', {
                        count: chunks.length,
                        chatId,
                    });
                    // Runtime fallback: shouldUseCard() 通过但 API 仍拒绝（表格数超限）
                    let cardTableLimitHit = false;
                    for (const chunk of chunks) {
                        if (cardTableLimitHit) {
                            // 已触发降级，后续 chunk 直接走纯文本
                            try {
                                await (0, send_1.sendMessageFeishu)({
                                    cfg,
                                    to: chatId,
                                    text: chunk,
                                    replyToMessageId,
                                    replyInThread,
                                    accountId,
                                    threadId,
                                });
                            }
                            catch (fallbackErr) {
                                if (staticGuard?.terminate('deliver.textFallback', fallbackErr))
                                    return;
                                throw fallbackErr;
                            }
                            continue;
                        }
                        try {
                            await (0, send_1.sendMarkdownCardFeishu)({
                                cfg,
                                to: chatId,
                                text: chunk,
                                replyToMessageId,
                                replyInThread,
                                accountId,
                            });
                        }
                        catch (err) {
                            if (staticGuard?.terminate('deliver.cardChunk', err))
                                return;
                            // 卡片表格数超出飞书限制 — 降级为纯文本
                            if ((0, card_error_1.isCardTableLimitError)(err)) {
                                log.warn('card table limit exceeded (230099/11310), falling back to text', { chatId });
                                cardTableLimitHit = true;
                                try {
                                    await (0, send_1.sendMessageFeishu)({
                                        cfg,
                                        to: chatId,
                                        text: chunk,
                                        replyToMessageId,
                                        replyInThread,
                                        accountId,
                                        threadId,
                                    });
                                }
                                catch (fallbackErr) {
                                    if (staticGuard?.terminate('deliver.textFallback', fallbackErr))
                                        return;
                                    throw fallbackErr;
                                }
                                continue;
                            }
                            throw err;
                        }
                    }
                }
                else {
                    const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
                    log.info('deliver: sending text chunks', {
                        count: chunks.length,
                        chatId,
                    });
                    for (const chunk of chunks) {
                        try {
                            await (0, send_1.sendMessageFeishu)({
                                cfg,
                                to: chatId,
                                text: chunk,
                                replyToMessageId,
                                replyInThread,
                                accountId,
                                threadId,
                            });
                        }
                        catch (err) {
                            if (staticGuard?.terminate('deliver.textChunk', err))
                                return;
                            throw err;
                        }
                    }
                }
            }
            // ---- Static media delivery ----
            for (const mediaUrl of payloadMediaUrls) {
                if (!mediaUrl?.trim())
                    continue;
                try {
                    log.info('deliver: sending media via static path', {
                        mediaUrl: mediaUrl.slice(0, 80),
                    });
                    await (0, deliver_1.sendMediaLark)({
                        cfg,
                        to: chatId,
                        mediaUrl,
                        accountId,
                        replyToMessageId,
                        replyInThread,
                    });
                }
                catch (mediaErr) {
                    if (staticGuard?.terminate('deliver.media', mediaErr))
                        return;
                    log.error('deliver: static media send failed', {
                        error: String(mediaErr),
                    });
                }
            }
        },
        onError: async (err, info) => {
            if (controller) {
                if (controller.terminateIfUnavailable('onError', err)) {
                    typingCallbacks.onIdle?.();
                    return;
                }
                await controller.onError(err, info);
                typingCallbacks.onIdle?.();
                return;
            }
            // Static mode error handling
            if (staticGuard?.terminate('onError', err)) {
                typingCallbacks.onIdle?.();
                return;
            }
            log.error(`${info.kind} reply failed`, { error: String(err) });
            typingCallbacks.onIdle?.();
        },
        onIdle: async () => {
            if (isTerminated() || shouldSkip('onIdle')) {
                typingCallbacks.onIdle?.();
                return;
            }
            if (!dispatchFullyComplete) {
                typingCallbacks.onIdle?.();
                return;
            }
            if (controller) {
                await controller.onIdle();
            }
            typingCallbacks.onIdle?.();
        },
        onCleanup: async () => {
            typingCallbacks.onCleanup?.();
        },
    });
    // ---- Abort card (delegates to controller or no-op for static) ----
    const abortCard = controller ? () => controller.abortCard() : async () => { };
    return {
        dispatcher,
        replyOptions: {
            ...replyOptions,
            ...(controller
                ? {
                    shouldEmitToolResult: () => false,
                    shouldEmitToolOutput: () => false,
                    // 让工具生命周期回调（onToolStart）在 verbose 关闭时也触发，
                    // 这样工具动态展示不再依赖全局 verbose 开关。
                    allowToolLifecycleWhenProgressHidden: true,
                }
                : {}),
            onModelSelected: (ctx) => {
                prefixContext.onModelSelected(ctx);
            },
            disableBlockStreaming: !enableBlockStreaming,
            ...(controller
                ? {
                    onReasoningStream: (payload) => controller.onReasoningStream(payload),
                    onPartialReply: (payload) => controller.onPartialReply(payload),
                    onToolStart: (payload) => controller.onToolStart(payload),
                }
                : {}),
        },
        markDispatchIdle,
        markFullyComplete: () => {
            dispatchFullyComplete = true;
            controller?.markFullyComplete();
        },
        abortCard,
    };
}
function getVisiblePayloadText(payload) {
    if (payload.isReasoning === true)
        return '';
    const rawText = payload.text ?? '';
    if (!rawText)
        return '';
    const split = (0, builder_1.splitReasoningText)(rawText);
    if (split.answerText != null) {
        return split.answerText;
    }
    return (0, builder_1.stripReasoningTags)(rawText);
}
function shouldRouteToolPayloadToCard(payload, showToolUse) {
    if (!showToolUse)
        return false;
    if (!getVisiblePayloadText(payload).trim())
        return false;
    if (payload.interactive)
        return false;
    if (payload.btw)
        return false;
    if (payload.audioAsVoice)
        return false;
    if (payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0)
        return false;
    const execApproval = payload.channelData && typeof payload.channelData === 'object' && !Array.isArray(payload.channelData)
        ? payload.channelData.execApproval
        : undefined;
    if (execApproval && typeof execApproval === 'object' && !Array.isArray(execApproval)) {
        return false;
    }
    return true;
}
