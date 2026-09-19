"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Streaming card controller for the Lark/Feishu channel plugin.
 *
 * Manages the full lifecycle of a streaming CardKit card:
 * idle → creating → streaming → completed / aborted / terminated.
 *
 * Delegates throttling to FlushController and message-unavailable
 * detection to UnavailableGuard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingCardController = void 0;
exports.prepareTerminalCardContent = prepareTerminalCardContent;
const promises_1 = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const agent_runtime_1 = require("openclaw/plugin-sdk/agent-runtime");
const reply_runtime_1 = require("openclaw/plugin-sdk/reply-runtime");
const api_error_1 = require("../core/api-error.js");
const lark_logger_1 = require("../core/lark-logger.js");
const lark_client_1 = require("../core/lark-client.js");
const shutdown_hooks_1 = require("../core/shutdown-hooks.js");
const send_1 = require("../messaging/outbound/send.js");
const builder_1 = require("./builder.js");
const card_error_1 = require("./card-error.js");
const cardkit_1 = require("./cardkit.js");
const flush_controller_1 = require("./flush-controller.js");
const image_resolver_1 = require("./image-resolver.js");
const markdown_style_1 = require("./markdown-style.js");
const tool_use_display_1 = require("./tool-use-display.js");
const tool_use_trace_store_1 = require("./tool-use-trace-store.js");
const reply_dispatcher_types_1 = require("./reply-dispatcher-types.js");
const unavailable_guard_1 = require("./unavailable-guard.js");
const log = (0, lark_logger_1.larkLogger)('card/streaming');
// ---------------------------------------------------------------------------
// StreamingCardController
// ---------------------------------------------------------------------------
class StreamingCardController {
    // ---- Explicit state machine ----
    phase = 'idle';
    // ---- Structured state ----
    cardKit = {
        cardKitCardId: null,
        originalCardKitCardId: null,
        cardKitSequence: 0,
        cardMessageId: null,
    };
    text = {
        accumulatedText: '',
        completedText: '',
        streamingPrefix: '',
        lastPartialText: '',
        lastFlushedText: '',
    };
    reasoning = {
        accumulatedReasoningText: '',
        reasoningStartTime: null,
        reasoningElapsedMs: 0,
        isReasoningPhase: false,
    };
    toolUse = {
        startedAt: null,
        elapsedMs: 0,
        isActive: false,
    };
    // ---- Sub-controllers ----
    flush;
    guard;
    imageResolver;
    // ---- Lifecycle ----
    createEpoch = 0;
    _terminalReason = null;
    dispatchFullyComplete = false;
    cardCreationPromise = null;
    disposeShutdownHook = null;
    dispatchStartTime = Date.now();
    // ---- Injected dependencies ----
    deps;
    elapsed() {
        return Date.now() - this.dispatchStartTime;
    }
    needsFooterMetrics() {
        const footer = this.deps.resolvedFooter;
        return footer.tokens || footer.cache || footer.context || footer.model;
    }
    async getFooterSessionMetrics() {
        try {
            const runtime = lark_client_1.LarkClient.runtime;
            if (!runtime)
                return undefined;
            // OpenClaw 2.0: per-session usage metrics live in the agent
            // transcript SQLite (transcript_events.message.usage), not the
            // legacy sessions.json file that 2.0 migrated away.
            const agentId = this.deps.agentId;
            const sessionKey = this.deps.sessionKey.trim().toLowerCase();
            const dbPath = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
            const { DatabaseSync } = require('node:sqlite');
            const db = new DatabaseSync(dbPath, { readOnly: true });
            try {
                const window = db.prepare('SELECT session_id FROM session_windows WHERE lower(session_key) = ? ORDER BY updated_at DESC LIMIT 1').get(sessionKey);
                if (!window)
                    return undefined;
                const row = db.prepare("SELECT event_json FROM transcript_events WHERE session_id = ? AND event_json LIKE '%usage%' ORDER BY rowid DESC LIMIT 1").get(window.session_id);
                if (!row)
                    return undefined;
                const ev = JSON.parse(row.event_json);
                const msg = ev?.message ?? {};
                const u = msg.usage;
                if (!u)
                    return undefined;
                const metrics = {
                    inputTokens: typeof u.input === 'number' ? u.input : undefined,
                    outputTokens: typeof u.output === 'number' ? u.output : undefined,
                    cacheRead: typeof u.cacheRead === 'number' ? u.cacheRead : undefined,
                    cacheWrite: typeof u.cacheWrite === 'number' ? u.cacheWrite : undefined,
                    totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : undefined,
                    model: typeof msg.model === 'string' ? msg.model : undefined,
                    provider: typeof msg.provider === 'string' ? msg.provider : undefined,
                    agentId,
                };
                // Best-effort context window from the model catalog in cfg.
                const ctxWindow = this.resolveContextWindow(msg.provider, msg.model);
                if (ctxWindow != null)
                    metrics.contextTokens = ctxWindow;
                log.debug('footer metrics lookup: found usage from agent transcript sqlite', {
                    sessionKey: this.deps.sessionKey,
                    agentId,
                });
                return metrics;
            }
            finally {
                db.close();
            }
        }
        catch (err) {
            log.warn('footer metrics lookup failed', { error: String(err), sessionKey: this.deps.sessionKey });
            return undefined;
        }
    }
    /** Resolve a model's context window from cfg.models.providers. */
    resolveContextWindow(provider, model) {
        try {
            const providers = this.deps.cfg?.models?.providers ?? {};
            const pcfg = providers[provider];
            if (!pcfg || !Array.isArray(pcfg.models))
                return undefined;
            const found = pcfg.models.find((m) => m && m.id === model);
            return typeof found?.contextWindow === 'number' ? found.contextWindow : undefined;
        }
        catch {
            return undefined;
        }
    }
    constructor(deps) {
        this.deps = deps;
        this.guard = new unavailable_guard_1.UnavailableGuard({
            replyToMessageId: deps.replyToMessageId,
            getCardMessageId: () => this.cardKit.cardMessageId,
            onTerminate: () => {
                this.transition('terminated', 'UnavailableGuard', 'unavailable');
            },
        });
        this.flush = new flush_controller_1.FlushController(() => this.performFlush());
        this.imageResolver = new image_resolver_1.ImageResolver({
            cfg: deps.cfg,
            accountId: deps.accountId,
            onImageResolved: () => {
                if (!this.isTerminalPhase && this.cardKit.cardMessageId) {
                    void this.throttledCardUpdate();
                }
            },
        });
    }
    // ------------------------------------------------------------------
    // Public accessors
    // ------------------------------------------------------------------
    get cardMessageId() {
        return this.cardKit.cardMessageId;
    }
    get isTerminalPhase() {
        return reply_dispatcher_types_1.TERMINAL_PHASES.has(this.phase);
    }
    /**
     * Whether the card has been explicitly aborted (via abortCard()).
     *
     * Distinct from isTerminalPhase — creation_failed is NOT an abort;
     * it should allow fallthrough to static delivery in the factory.
     */
    get isAborted() {
        return this.phase === 'aborted';
    }
    /** Whether the reply pipeline was terminated due to an unavailable message. */
    get isTerminated() {
        return this.guard.isTerminated;
    }
    /** Check if the pipeline should skip further operations for this source. */
    shouldSkipForUnavailable(source) {
        return this.guard.shouldSkip(source);
    }
    /** Attempt to terminate the pipeline due to an unavailable message error. */
    terminateIfUnavailable(source, err) {
        return this.guard.terminate(source, err);
    }
    /** Why the controller entered a terminal phase, or null if still active. */
    get terminalReason() {
        return this._terminalReason;
    }
    /** @internal — exposed for test assertions only. */
    get currentPhase() {
        return this.phase;
    }
    get shouldDisplayToolUse() {
        return this.deps.toolUseDisplay.showToolUse;
    }
    /**
     * Activity-only mode (static/group replies): the controller drives a
     * lightweight tool-activity card only — text/reasoning streaming is
     * handled by the static deliver() path, so those callbacks are no-ops
     * and the card is removed once the final reply is delivered.
     */
    get activityOnly() {
        return this.deps.activityOnly === true;
    }
    computeToolUseDisplay() {
        if (!this.shouldDisplayToolUse)
            return null;
        const traceSteps = (0, tool_use_trace_store_1.getToolUseTraceSteps)(this.deps.sessionKey);
        return (0, tool_use_display_1.normalizeToolUseDisplay)({
            traceSteps,
            showFullPaths: this.deps.toolUseDisplay.showFullPaths,
            showResultDetails: this.deps.toolUseDisplay.showToolResultDetails,
        });
    }
    get visibleToolUseElapsedMs() {
        if (!this.shouldDisplayToolUse || !this.toolUse.startedAt) {
            return undefined;
        }
        return this.toolUse.elapsedMs || Date.now() - this.toolUse.startedAt;
    }
    computeToolUseTitleSuffix(display) {
        if (!this.shouldDisplayToolUse)
            return undefined;
        const stepCount = display?.stepCount ?? 0;
        return stepCount > 0 ? (0, tool_use_display_1.buildToolUseTitleSuffix)({ stepCount }) : undefined;
    }
    // ------------------------------------------------------------------
    // Unified callback guard
    // ------------------------------------------------------------------
    /**
     * Unified callback guard — returns true if the pipeline is active
     * and the callback should proceed.
     *
     * Combines three checks:
     * 1. guard.isTerminated — message recalled/deleted
     * 2. guard.shouldSkip(source) — eagerly detect unavailable messages
     * 3. isTerminalPhase — completed/aborted/terminated/creation_failed
     */
    shouldProceed(source) {
        if (this.guard.isTerminated || this.guard.shouldSkip(source))
            return false;
        return !this.isTerminalPhase;
    }
    // ------------------------------------------------------------------
    // State machine
    // ------------------------------------------------------------------
    isStaleCreate(epoch) {
        return epoch !== this.createEpoch;
    }
    transition(to, source, reason) {
        const from = this.phase;
        if (from === to)
            return false;
        if (!reply_dispatcher_types_1.PHASE_TRANSITIONS[from].has(to)) {
            log.warn('phase transition rejected', { from, to, source });
            return false;
        }
        this.phase = to;
        log.info('phase transition', { from, to, source, reason });
        if (reply_dispatcher_types_1.TERMINAL_PHASES.has(to)) {
            this._terminalReason = reason ?? null;
            this.onEnterTerminalPhase();
        }
        return true;
    }
    onEnterTerminalPhase() {
        this.createEpoch += 1;
        this.flush.cancelPendingFlush();
        this.flush.complete();
        this.disposeShutdownHook?.();
        this.disposeShutdownHook = null;
        if (this.phase === 'terminated' || this.phase === 'creation_failed') {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    markToolUseActivity() {
        if (!this.toolUse.startedAt) {
            this.toolUse.startedAt = Date.now();
        }
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = true;
    }
    captureToolUseElapsed() {
        if (!this.toolUse.startedAt)
            return;
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = false;
    }
    // ------------------------------------------------------------------
    // SDK callback bindings
    // ------------------------------------------------------------------
    /**
     * Handle a deliver() call in streaming card mode.
     *
     * Accumulates text from the SDK's deliver callbacks to build the
     * authoritative "completedText" for the final card.
     */
    async onDeliver(payload) {
        if (!this.shouldProceed('onDeliver'))
            return;
        if (this.activityOnly)
            return;
        const text = payload.text ?? '';
        if (!text.trim())
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onDeliver.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        this.captureToolUseElapsed();
        const split = (0, builder_1.splitReasoningText)(text);
        if (split.reasoningText && !split.answerText) {
            // Pure reasoning payload
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
            await this.throttledCardUpdate();
            return;
        }
        // Answer payload (may also contain inline reasoning from tags)
        this.reasoning.isReasoningPhase = false;
        if (split.reasoningText) {
            this.reasoning.accumulatedReasoningText = split.reasoningText;
        }
        const answerText = split.answerText ?? text;
        // 累积 deliver 文本用于最终卡片
        this.text.completedText += (this.text.completedText ? '\n\n' : '') + answerText;
        // 没有流式数据时，用 deliver 文本显示在卡片上
        if (!this.text.lastPartialText && !this.text.streamingPrefix) {
            this.text.accumulatedText += (this.text.accumulatedText ? '\n\n' : '') + answerText;
            this.text.streamingPrefix = this.text.accumulatedText;
            await this.throttledCardUpdate();
        }
    }
    async onReasoningStream(payload) {
        if (!this.shouldProceed('onReasoningStream'))
            return;
        if (this.activityOnly)
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onReasoningStream.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        const rawText = payload.text ?? '';
        if (!rawText)
            return;
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        this.reasoning.isReasoningPhase = true;
        const split = (0, builder_1.splitReasoningText)(rawText);
        this.reasoning.accumulatedReasoningText = split.reasoningText ?? rawText;
        await this.throttledCardUpdate();
    }
    async onToolStart(payload) {
        if (!this.shouldProceed('onToolStart'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        const phase = payload.phase ?? 'start';
        // 把工具生命周期写入 trace store，卡片才能渲染出"正在调用什么工具"的步骤。
        if (phase === 'start') {
            (0, tool_use_trace_store_1.recordToolUseStart)({
                sessionKey: this.deps.sessionKey,
                toolName: payload.name,
                toolParams: payload.args,
                toolCallId: payload.toolCallId,
            });
        }
        else if (phase === 'end' || phase === 'error' || phase === 'result') {
            (0, tool_use_trace_store_1.recordToolUseEnd)({
                sessionKey: this.deps.sessionKey,
                toolName: payload.name,
                toolParams: payload.args,
                toolCallId: payload.toolCallId,
                error: phase === 'error' ? 'tool failed' : undefined,
            });
        }
        else {
            return;
        }
        if (phase === 'start') {
            this.markToolUseActivity();
        }
        else {
            this.captureToolUseElapsed();
        }
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolStart.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        if (this.activityOnly) {
            if (this.cardKit.cardKitCardId) {
                await this.throttledToolUseStatusUpdate();
            }
            else {
                await this.throttledCardUpdate();
            }
            return;
        }
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onToolPayload(_payload) {
        if (!this.shouldProceed('onToolPayload'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        this.markToolUseActivity();
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolPayload.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        if (this.activityOnly) {
            if (this.cardKit.cardKitCardId) {
                await this.throttledToolUseStatusUpdate();
            }
            else {
                await this.throttledCardUpdate();
            }
            return;
        }
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onPartialReply(payload) {
        if (!this.shouldProceed('onPartialReply'))
            return;
        if (this.activityOnly)
            return;
        // Use splitReasoningText (consistent with onDeliver/onReasoningStream)
        // to extract <think> tag content before stripping it from the answer.
        // Previously only stripReasoningTags was called, silently discarding
        // any thinking content that the LLM wrapped in <think> tags.
        const rawText = payload.text ?? '';
        const split = (0, builder_1.splitReasoningText)(rawText);
        if (split.reasoningText) {
            if (!this.reasoning.reasoningStartTime) {
                this.reasoning.reasoningStartTime = Date.now();
            }
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
        }
        const text = split.answerText ?? (0, builder_1.stripReasoningTags)(rawText);
        log.debug('onPartialReply', { len: text.length });
        if (!text)
            return;
        this.captureToolUseElapsed();
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        if (this.reasoning.isReasoningPhase) {
            this.reasoning.isReasoningPhase = false;
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
        }
        // 检测回复边界：文本长度缩短 → 新回复开始
        if (this.text.lastPartialText && text.length < this.text.lastPartialText.length) {
            this.text.streamingPrefix += (this.text.streamingPrefix ? '\n\n' : '') + this.text.lastPartialText;
        }
        this.text.lastPartialText = text;
        this.text.accumulatedText = this.text.streamingPrefix ? this.text.streamingPrefix + '\n\n' + text : text;
        // NO_REPLY 缓冲
        if (!this.text.streamingPrefix && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim())) {
            log.debug('onPartialReply: buffering NO_REPLY prefix');
            return;
        }
        await this.ensureCardCreated();
        if (!this.shouldProceed('onPartialReply.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        await this.throttledCardUpdate();
    }
    async onError(err, info) {
        if (this.guard.terminate('onError', err))
            return;
        log.error(`${info.kind} reply failed`, { error: String(err) });
        if (this.activityOnly) {
            await this.deleteActivityCard('onError');
            return;
        }
        this.captureToolUseElapsed();
        this.finalizeCard('onError', 'error');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise)
            await this.cardCreationPromise;
        const errorEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
        const toolUseDisplay = this.computeToolUseDisplay();
        const rawErrorText = this.cardKit.cardMessageId && this.text.accumulatedText
            ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred while generating the response.`
            : '**Error**: An error occurred while generating the response.';
        try {
            if (this.cardKit.cardMessageId) {
                const terminalContent = prepareTerminalCardContent({
                    text: rawErrorText,
                    reasoningText: this.reasoning.accumulatedReasoningText || undefined,
                }, this.imageResolver);
                const { card: errorCard } = (0, builder_1.buildBoundedCompleteCard)({
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: toolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(toolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    isError: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                });
                if (errorEffectiveCardId) {
                    await this.closeStreamingAndUpdate(errorEffectiveCardId, errorCard, 'onError');
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: errorCard,
                        accountId: this.deps.accountId,
                    });
                }
            }
        }
        catch (err) {
            // Ignore update failures during error handling, but never leave the
            // user without any signal that the run failed.
            log.warn('error card update failed', { error: String(err) });
            await this.deliverTerminalFallback(rawErrorText, 'error-card-failed');
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    async onIdle() {
        if (this.guard.isTerminated || this.guard.shouldSkip('onIdle'))
            return;
        if (!this.dispatchFullyComplete)
            return;
        if (this.isTerminalPhase)
            return;
        this.captureToolUseElapsed();
        if (this.activityOnly) {
            // 静态模式：最终回复已通过 deliver() 单独发送，删除活动卡即可。
            await this.deleteActivityCard('onIdle');
            return;
        }
        this.finalizeCard('onIdle', 'normal');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            await this.flush.waitForFlush();
        }
        const idleEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        // Resolve the terminal text up front so a failure anywhere below can
        // still fall back to a plain-text delivery instead of losing the reply.
        const isNoReplyLeak = !this.text.completedText && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim());
        const displayText = this.text.completedText || (isNoReplyLeak ? '' : this.text.accumulatedText) || reply_dispatcher_types_1.EMPTY_REPLY_FALLBACK_TEXT;
        if (!this.text.completedText && !this.text.accumulatedText) {
            log.warn('reply completed without visible text, using empty-reply fallback');
        }
        let fallbackText = displayText;
        try {
            if (this.cardKit.cardMessageId) {
                if (idleEffectiveCardId) {
                    const seqBeforeClose = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: closing streaming mode', {
                        seqBefore: seqBeforeClose,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.setCardStreamingMode)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        streamingMode: false,
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                // 等待图片异步解析（最多 15s），避免终态卡片留占位符
                const resolvedDisplayText = await this.imageResolver.resolveImagesAwait(displayText, 15_000);
                fallbackText = resolvedDisplayText;
                const idleToolUseDisplay = this.computeToolUseDisplay();
                const terminalContent = prepareTerminalCardContent({
                    text: resolvedDisplayText,
                    reasoningText: this.reasoning.accumulatedReasoningText || undefined,
                }, this.imageResolver);
                const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
                // Build within Feishu's hard limits (200 elements / 30KB) instead
                // of sending an oversized card that the API rejects outright.
                const { card: completeCard, truncatedText } = (0, builder_1.buildBoundedCompleteCard)({
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: idleToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(idleToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                });
                if (idleEffectiveCardId) {
                    const seqBeforeUpdate = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: updating final card', {
                        seqBefore: seqBeforeUpdate,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.updateCardKitCard)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        card: (0, builder_1.toCardKit2)(completeCard),
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: completeCard,
                        accountId: this.deps.accountId,
                    });
                }
                log.info('reply completed, card finalized', {
                    elapsedMs: this.elapsed(),
                    isCardKit: !!idleEffectiveCardId,
                    truncatedText,
                });
                if (truncatedText) {
                    // The card had to shorten the visible answer — deliver the
                    // full text out of band so nothing is lost.
                    await this.deliverTerminalFallback(resolvedDisplayText, 'card-truncated');
                }
            }
        }
        catch (err) {
            log.warn('final card update failed', { error: String(err) });
            // Terminal card could not be updated: the streaming card is the only
            // delivery vehicle, so the reply would otherwise be lost silently.
            await this.deliverTerminalFallback(fallbackText, 'card-update-failed');
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    /**
     * Last-resort delivery of the reply as a plain-text message.
     *
     * Used when the terminal card cannot be updated (Feishu 300305/200860,
     * streaming-mode errors, …) or when the card had to truncate the answer.
     * Without this the user sees a frozen card and never receives the answer.
     * Returns true when the fallback was sent.
     */
    async deliverTerminalFallback(text, reason) {
        const deliver = this.deps.deliverFallbackText;
        const body = (text ?? '').trim();
        if (!deliver || !body) {
            log.warn('terminal fallback skipped (no text or no delivery hook)', { reason });
            return false;
        }
        if (body === reply_runtime_1.SILENT_REPLY_TOKEN) {
            return false;
        }
        try {
            await deliver(body);
            log.info('terminal reply delivered via plain-text fallback', { reason });
            return true;
        }
        catch (fallbackErr) {
            log.error('terminal fallback delivery failed', {
                reason,
                error: String(fallbackErr),
            });
            return false;
        }
    }
    // ------------------------------------------------------------------
    // External control
    // ------------------------------------------------------------------
    markFullyComplete() {
        log.debug('markFullyComplete', {
            completedTextLen: this.text.completedText.length,
            accumulatedTextLen: this.text.accumulatedText.length,
        });
        this.dispatchFullyComplete = true;
    }
    /**
     * Activity-only mode terminal: remove the tool-activity card.
     *
     * The final reply is delivered as a separate static message, so the
     * ephemeral activity card must be deleted rather than finalized into
     * the answer. Failure to delete (e.g. permission) is non-fatal.
     */
    async deleteActivityCard(source) {
        try {
            if (this.cardKit.cardMessageId) {
                await (0, send_1.deleteMessageFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    accountId: this.deps.accountId,
                });
                log.info('activity card removed', { source, messageId: this.cardKit.cardMessageId });
            }
        }
        catch (err) {
            log.warn('activity card delete failed', { source, error: String(err) });
        }
        finally {
            this.transition('completed', 'deleteActivityCard', source);
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    async abortCard() {
        try {
            if (this.activityOnly) {
                await this.deleteActivityCard('abortCard');
                return;
            }
            this.captureToolUseElapsed();
            if (!this.transition('aborted', 'abortCard', 'abort'))
                return;
            // transition() already executed onEnterTerminalPhase (cancel + complete + dispose hook)
            // Only need to wait for any in-flight flush to finish
            await this.flush.waitForFlush();
            if (this.cardCreationPromise)
                await this.cardCreationPromise;
            const effectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
            const elapsedMs = Date.now() - this.dispatchStartTime;
            const abortToolUseDisplay = this.computeToolUseDisplay();
            const terminalContent = prepareTerminalCardContent({
                text: this.text.accumulatedText || 'Aborted.',
                reasoningText: this.reasoning.accumulatedReasoningText || undefined,
            }, this.imageResolver);
            const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
            // Bounded so an oversized abort card can't be rejected by Feishu.
            const { card: abortCardContent } = (0, builder_1.buildBoundedCompleteCard)({
                text: terminalContent.text,
                reasoningText: terminalContent.reasoningText,
                reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                toolUseSteps: abortToolUseDisplay?.steps,
                toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
                toolUseElapsedMs: this.visibleToolUseElapsedMs,
                showToolUse: this.deps.toolUseDisplay.showToolUse,
                elapsedMs,
                isAborted: true,
                footer: this.deps.resolvedFooter,
                footerMetrics,
            });
            if (effectiveCardId) {
                await this.closeStreamingAndUpdate(effectiveCardId, abortCardContent, 'abortCard');
                log.info('abortCard completed', { effectiveCardId });
            }
            else if (this.cardKit.cardMessageId) {
                // IM fallback: 卡片不是通过 CardKit 发的，用 im.message.patch 更新
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card: abortCardContent,
                    accountId: this.deps.accountId,
                });
                log.info('abortCard completed (IM fallback)', {
                    messageId: this.cardKit.cardMessageId,
                });
            }
        }
        catch (err) {
            log.warn('abortCard failed', { error: String(err) });
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    // ------------------------------------------------------------------
    // Internal: card creation
    // ------------------------------------------------------------------
    async ensureCardCreated() {
        if (this.guard.shouldSkip('ensureCardCreated.precheck'))
            return;
        if (this.cardKit.cardMessageId || this.phase === 'creation_failed' || this.isTerminalPhase) {
            return;
        }
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            return;
        }
        if (!this.transition('creating', 'ensureCardCreated'))
            return;
        this.createEpoch += 1;
        const epoch = this.createEpoch;
        this.cardCreationPromise = (async () => {
            try {
                try {
                    // Step 1: Create card entity
                    const cId = await (0, cardkit_1.createCardEntity)({
                        cfg: this.deps.cfg,
                        card: (0, builder_1.buildStreamingThinkingCard)(this.deps.toolUseDisplay.showToolUse),
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after createCardEntity, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    if (cId) {
                        this.cardKit.cardKitCardId = cId;
                        this.cardKit.originalCardKitCardId = cId;
                        this.cardKit.cardKitSequence = 1;
                        this.disposeShutdownHook = (0, shutdown_hooks_1.registerShutdownHook)(`streaming-card:${cId}`, () => this.abortCard());
                        log.info('created CardKit entity', {
                            cardId: cId,
                            initialSequence: this.cardKit.cardKitSequence,
                        });
                        // Step 2: Send IM message referencing card_id
                        const result = await (0, cardkit_1.sendCardByCardId)({
                            cfg: this.deps.cfg,
                            to: this.deps.chatId,
                            cardId: cId,
                            replyToMessageId: this.deps.replyToMessageId,
                            replyInThread: this.deps.replyInThread,
                            accountId: this.deps.accountId,
                        });
                        if (this.isStaleCreate(epoch)) {
                            log.info('ensureCardCreated: stale epoch after sendCardByCardId, bailing out', {
                                epoch,
                                phase: this.phase,
                            });
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        this.cardKit.cardMessageId = result.messageId;
                        this.flush.setCardMessageReady(true);
                        if (!this.transition('streaming', 'ensureCardCreated.cardkit')) {
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        log.info('sent CardKit card', { messageId: result.messageId });
                    }
                    else {
                        throw new Error('card.create returned empty card_id');
                    }
                }
                catch (cardKitErr) {
                    if (this.isStaleCreate(epoch))
                        return;
                    if (this.guard.terminate('ensureCardCreated.cardkitFlow', cardKitErr)) {
                        return;
                    }
                    // CardKit flow failed — fall back to regular IM card
                    const apiDetail = extractApiDetail(cardKitErr);
                    log.warn('CardKit flow failed, falling back to IM', { apiDetail });
                    this.cardKit.cardKitCardId = null;
                    this.cardKit.originalCardKitCardId = null;
                    const fallbackCard = (0, builder_1.buildCardContent)('streaming', {
                        showToolUse: this.deps.toolUseDisplay.showToolUse,
                    });
                    const result = await (0, send_1.sendCardFeishu)({
                        cfg: this.deps.cfg,
                        to: this.deps.chatId,
                        card: fallbackCard,
                        replyToMessageId: this.deps.replyToMessageId,
                        replyInThread: this.deps.replyInThread,
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after IM fallback send, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    this.cardKit.cardMessageId = result.messageId;
                    this.flush.setCardMessageReady(true);
                    if (!this.transition('streaming', 'ensureCardCreated.imFallback')) {
                        return;
                    }
                    log.info('sent fallback IM card', { messageId: result.messageId });
                }
            }
            catch (err) {
                if (this.isStaleCreate(epoch))
                    return;
                if (this.guard.terminate('ensureCardCreated.outer', err)) {
                    return;
                }
                log.warn('thinking card failed, falling back to static', {
                    error: String(err),
                });
                this.transition('creation_failed', 'ensureCardCreated.outer', 'creation_failed');
            }
        })();
        await this.cardCreationPromise;
    }
    // ------------------------------------------------------------------
    // Internal: flush
    // ------------------------------------------------------------------
    async performFlush() {
        if (!this.cardKit.cardMessageId || this.isTerminalPhase)
            return;
        // v2 CardKit 卡片不能走 IM patch，如果流式 CardKit 已禁用但 originalCardKitCardId
        // 仍在，说明卡片是通过 CardKit 发的——跳过中间态更新，等终态用 originalCardKitCardId 收尾
        if (!this.cardKit.cardKitCardId && this.cardKit.originalCardKitCardId) {
            log.debug('performFlush: skipping (CardKit streaming disabled, awaiting final update)');
            return;
        }
        log.debug('flushCardUpdate: enter', {
            seq: this.cardKit.cardKitSequence,
            isCardKit: !!this.cardKit.cardKitCardId,
        });
        try {
            const displayText = this.buildDisplayText();
            // 流式中间帧使用同步 resolveImages（不等待异步上传）
            const resolvedText = this.imageResolver.resolveImages(displayText);
            if (this.cardKit.cardKitCardId) {
                if (resolvedText !== this.text.lastFlushedText) {
                    const prevSeq = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.debug('flushCardUpdate: answer seq bump', {
                        seqBefore: prevSeq,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.streamCardContent)({
                        cfg: this.deps.cfg,
                        cardId: this.cardKit.cardKitCardId,
                        elementId: builder_1.STREAMING_ELEMENT_ID,
                        content: (0, markdown_style_1.optimizeMarkdownStyle)(resolvedText),
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                    this.text.lastFlushedText = resolvedText;
                }
            }
            else {
                log.debug('flushCardUpdate: IM patch fallback');
                const flushDisplay = this.computeToolUseDisplay();
                const card = (0, builder_1.buildCardContent)('streaming', {
                    text: this.reasoning.isReasoningPhase ? '' : resolvedText,
                    reasoningText: this.reasoning.isReasoningPhase ? this.reasoning.accumulatedReasoningText : undefined,
                    toolUseSteps: flushDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(flushDisplay),
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                });
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card: card,
                    accountId: this.deps.accountId,
                });
            }
        }
        catch (err) {
            if (this.guard.terminate('flushCardUpdate', err))
                return;
            const apiCode = (0, api_error_1.extractLarkApiCode)(err);
            // 速率限制（230020）— 跳过此帧，不降级
            if ((0, card_error_1.isCardRateLimitError)(err)) {
                log.info('flushCardUpdate: rate limited (230020), skipping', {
                    seq: this.cardKit.cardKitSequence,
                });
                return;
            }
            // 卡片表格数超出飞书限制（230099/11310）— 禁用 CardKit 流式，
            // 保留 originalCardKitCardId 供 onIdle 做最终 CardKit 更新
            if ((0, card_error_1.isCardTableLimitError)(err)) {
                log.warn('flushCardUpdate: card table limit exceeded (230099/11310), disabling CardKit streaming', {
                    seq: this.cardKit.cardKitSequence,
                });
                this.cardKit.cardKitCardId = null;
                return;
            }
            const apiDetail = extractApiDetail(err);
            log.error('card stream update failed', {
                apiCode,
                seq: this.cardKit.cardKitSequence,
                apiDetail,
            });
            if (this.cardKit.cardKitCardId) {
                log.warn('disabling CardKit streaming, falling back to im.message.patch');
                this.cardKit.cardKitCardId = null;
            }
        }
    }
    buildDisplayText() {
        if (this.reasoning.isReasoningPhase && this.reasoning.accumulatedReasoningText) {
            const reasoningDisplay = `💭 **Thinking...**\n\n${this.reasoning.accumulatedReasoningText}`;
            return this.text.accumulatedText ? this.text.accumulatedText + '\n\n' + reasoningDisplay : reasoningDisplay;
        }
        return this.text.accumulatedText;
    }
    async throttledCardUpdate() {
        if (this.guard.shouldSkip('throttledCardUpdate'))
            return;
        const throttleMs = this.cardKit.cardKitCardId ? reply_dispatcher_types_1.THROTTLE_CONSTANTS.CARDKIT_MS : reply_dispatcher_types_1.THROTTLE_CONSTANTS.PATCH_MS;
        await this.flush.throttledUpdate(throttleMs);
    }
    // ---- Tool-use status streaming (pre-answer phase) ----
    lastToolUseStatusUpdateTime = 0;
    async throttledToolUseStatusUpdate() {
        if (!this.cardKit.cardKitCardId)
            return;
        const now = Date.now();
        if (now - this.lastToolUseStatusUpdateTime < reply_dispatcher_types_1.THROTTLE_CONSTANTS.REASONING_STATUS_MS)
            return;
        this.lastToolUseStatusUpdateTime = now;
        await this.updateToolUseStatus();
    }
    async updateToolUseStatus() {
        if (!this.cardKit.cardKitCardId || this.isTerminalPhase)
            return;
        try {
            const display = this.computeToolUseDisplay();
            const card = (0, builder_1.buildStreamingPreAnswerCard)({
                steps: display?.steps,
                elapsedMs: this.visibleToolUseElapsedMs,
                showToolUse: this.shouldDisplayToolUse,
            });
            this.cardKit.cardKitSequence += 1;
            await (0, cardkit_1.updateCardKitCard)({
                cfg: this.deps.cfg,
                cardId: this.cardKit.cardKitCardId,
                card,
                sequence: this.cardKit.cardKitSequence,
                accountId: this.deps.accountId,
            });
        }
        catch (err) {
            log.debug('updateToolUseStatus failed', { error: String(err) });
        }
    }
    // ------------------------------------------------------------------
    // Internal: lifecycle helpers
    // ------------------------------------------------------------------
    finalizeCard(source, reason) {
        this.transition('completed', source, reason);
    }
    /**
     * Close streaming mode then update card content (shared by onError and abortCard).
     */
    async closeStreamingAndUpdate(cardId, card, label) {
        const seqBeforeClose = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: closing streaming mode`, {
            seqBefore: seqBeforeClose,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.setCardStreamingMode)({
            cfg: this.deps.cfg,
            cardId,
            streamingMode: false,
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
        const seqBeforeUpdate = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: updating card`, {
            seqBefore: seqBeforeUpdate,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.updateCardKitCard)({
            cfg: this.deps.cfg,
            cardId,
            card: (0, builder_1.toCardKit2)(card),
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
    }
}
exports.StreamingCardController = StreamingCardController;
// ---------------------------------------------------------------------------
// Error detail extraction helpers (replacing `any` casts)
// ---------------------------------------------------------------------------
/**
 * 终态卡片的正文和 reasoning 都会被飞书按 markdown 渲染，
 * 因此两者都要先做图片替换与表格降级，避免再次撞到 230099/11310。
 */
function prepareTerminalCardContent(content, imageResolver, tableLimit = card_error_1.FEISHU_CARD_TABLE_LIMIT) {
    const resolvedReasoningText = content.reasoningText ? imageResolver.resolveImages(content.reasoningText) : undefined;
    const resolvedText = imageResolver.resolveImages(content.text);
    const sanitizedSegments = (0, card_error_1.sanitizeTextSegmentsForCard)(resolvedReasoningText ? [resolvedReasoningText, resolvedText] : [resolvedText], tableLimit);
    if (resolvedReasoningText) {
        return {
            reasoningText: sanitizedSegments[0],
            text: sanitizedSegments[1],
        };
    }
    return { text: sanitizedSegments[0] };
}
function extractApiDetail(err) {
    if (!err || typeof err !== 'object')
        return String(err);
    const e = err;
    return e.response?.data ? JSON.stringify(e.response.data) : String(err);
}
