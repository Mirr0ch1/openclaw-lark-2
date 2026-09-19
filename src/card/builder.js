"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Interactive card building for Lark/Feishu.
 *
 * Provides utilities to construct Feishu Interactive Message Cards for
 * different agent response states (thinking, streaming, complete, confirm).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REASONING_ELEMENT_ID = exports.STREAMING_ELEMENT_ID = void 0;
exports.CARD_SIZE_LIMIT_BYTES = exports.CARD_ELEMENT_LIMIT = void 0;
exports.splitReasoningText = splitReasoningText;
exports.stripReasoningTags = stripReasoningTags;
exports.formatReasoningDuration = formatReasoningDuration;
exports.formatToolUseDuration = formatToolUseDuration;
exports.formatElapsed = formatElapsed;
exports.compactNumber = compactNumber;
exports.formatFooterRuntimeSegments = formatFooterRuntimeSegments;
exports.buildCardContent = buildCardContent;
exports.buildStreamingThinkingCard = buildStreamingThinkingCard;
exports.buildStreamingPreAnswerCard = buildStreamingPreAnswerCard;
exports.buildBoundedCompleteCard = buildBoundedCompleteCard;
exports.countCardElements = countCardElements;
exports.estimateCardBytes = estimateCardBytes;
exports.toCardKit2 = toCardKit2;
const markdown_style_1 = require("./markdown-style.js");
const tool_use_display_1 = require("./tool-use-display.js");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Element ID used for the streaming text area in cards. The CardKit
 * `cardElement.content()` API targets this element for typewriter-effect
 * streaming updates.
 */
exports.STREAMING_ELEMENT_ID = 'streaming_content';
exports.REASONING_ELEMENT_ID = 'reasoning_content';
const TOOL_USE_STEP_CONTENT_INDENT = '0px 0px 0px 22px';
/**
 * Feishu card JSON 2.0 hard limit: a card may contain at most 200
 * elements/components. Exceeding it makes `card.update` fail with
 * code 300305 ("The number of card components exceeds 200"), which
 * silently drops the whole reply — see streaming-card-controller onIdle.
 */
const CARD_ELEMENT_LIMIT = 200;
exports.CARD_ELEMENT_LIMIT = CARD_ELEMENT_LIMIT;
/** Feishu `card.update` rejects cards whose JSON exceeds 30KB (code 200860). */
const CARD_SIZE_LIMIT_BYTES = 30 * 1024;
exports.CARD_SIZE_LIMIT_BYTES = CARD_SIZE_LIMIT_BYTES;
/**
 * Element budget handed to the tool-use panel, counted the way Feishu
 * counts (a `div` plus its nested `plain_text`/`lark_md` text node are two
 * elements). Kept well below CARD_ELEMENT_LIMIT so the panel header,
 * reasoning panel, answer text, footer and truncation notice still fit.
 */
const TOOL_USE_STEP_ELEMENT_BUDGET = 150;
/**
 * Byte budget used when building the terminal card. Kept below
 * CARD_SIZE_LIMIT_BYTES to leave headroom for JSON escaping overhead.
 */
const CARD_SIZE_BUDGET_BYTES = 28 * 1024;
/**
 * Tool result/error code blocks are clipped to keep the card under 30KB.
 * The full output stays available in the agent transcript.
 */
const TOOL_USE_OUTPUT_MAX_CHARS = 400;
/** Cost (counted elements) of the truncation notice: div + plain_text. */
const TOOL_USE_NOTICE_ELEMENT_COST = 2;
/**
 * Reasoning is shown in a collapsed panel; a long agentic run can
 * accumulate tens of thousands of chars of thinking, which alone blows
 * the 30KB card budget. Clip it (and drop it entirely if still too big).
 */
const REASONING_MAX_CHARS = 6000;
/** Last-resort clip for the visible answer when even a slim card is too big. */
const ANSWER_MAX_CHARS_BUDGET = 12000;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// ---- Reasoning text utilities ----
// Mirrors the logic in the framework's `splitTelegramReasoningText` and
// related helpers from `plugin-sdk/telegram/reasoning-lane-coordinator`.
// Those are not exported from the public plugin-sdk entry, so we replicate
// the same detection/splitting logic here.
const REASONING_PREFIX = 'Reasoning:\n';
/**
 * Split a payload text into optional `reasoningText` and `answerText`.
 *
 * Handles two formats produced by the framework:
 * 1. "Reasoning:\n_italic line_\n…" prefix (from `formatReasoningMessage`)
 * 2. `<think>…</think>` / `<thinking>…</thinking>` XML tags
 *
 * Equivalent to the framework's `splitTelegramReasoningText()`.
 */
function splitReasoningText(text) {
    if (typeof text !== 'string' || !text.trim())
        return {};
    const trimmed = text.trim();
    // Case 1: "Reasoning:\n..." prefix — the entire payload is reasoning
    if (trimmed.startsWith(REASONING_PREFIX) && trimmed.length > REASONING_PREFIX.length) {
        return { reasoningText: cleanReasoningPrefix(trimmed) };
    }
    // Case 2: XML thinking tags — extract content and strip from answer
    const taggedReasoning = extractThinkingContent(text);
    const strippedAnswer = stripReasoningTags(text);
    if (!taggedReasoning && strippedAnswer === text) {
        return { answerText: text };
    }
    return {
        reasoningText: taggedReasoning || undefined,
        answerText: strippedAnswer || undefined,
    };
}
/**
 * Extract content from `<think>`, `<thinking>`, `<thought>` blocks.
 * Handles both closed and unclosed (streaming) tags.
 */
function extractThinkingContent(text) {
    if (!text)
        return '';
    const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
    let result = '';
    let lastIndex = 0;
    let inThinking = false;
    for (const match of text.matchAll(scanRe)) {
        const idx = match.index ?? 0;
        if (inThinking) {
            result += text.slice(lastIndex, idx);
        }
        inThinking = match[1] !== '/';
        lastIndex = idx + match[0].length;
    }
    // Handle unclosed tag (still streaming)
    if (inThinking) {
        result += text.slice(lastIndex);
    }
    return result.trim();
}
/**
 * Strip reasoning blocks — both XML tags with their content and any
 * "Reasoning:\n" prefixed content.
 */
function stripReasoningTags(text) {
    // Strip complete XML blocks
    let result = text.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
    // Strip unclosed tag at end (streaming)
    result = result.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*$/gi, '');
    // Strip orphaned closing tags
    result = result.replace(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
    return result.trim();
}
/**
 * Clean a "Reasoning:\n_italic_" formatted message back to plain text.
 * Strips the prefix and per-line italic markdown wrappers.
 */
function cleanReasoningPrefix(text) {
    let cleaned = text.replace(/^Reasoning:\s*/i, '');
    cleaned = cleaned
        .split('\n')
        .map((line) => line.replace(/^_(.+)_$/, '$1'))
        .join('\n');
    return cleaned.trim();
}
/**
 * Format reasoning duration into a human-readable i18n pair.
 * e.g. { zh: "思考了 3.2s", en: "Thought for 3.2s" }
 */
function formatReasoningDuration(ms) {
    const d = formatElapsed(ms);
    return { zh: `思考了 ${d}`, en: `Thought for ${d}` };
}
/**
 * Format tool-use duration into a human-readable i18n pair.
 */
function formatToolUseDuration(ms) {
    const d = formatElapsed(ms);
    return { zh: `执行耗时 ${d}`, en: `Tool use for ${d}` };
}
/**
 * Format milliseconds into a human-readable duration string.
 */
function formatElapsed(ms) {
    const seconds = ms / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
/**
 * Build footer meta-info: notation-sized text with i18n support.
 * Error text is rendered in red; normal text uses default grey (notation).
 */
function buildFooter(zhText, enText, isError) {
    const zhContent = isError ? `<font color='red'>${zhText}</font>` : zhText;
    const enContent = isError ? `<font color='red'>${enText}</font>` : enText;
    return [
        {
            tag: 'markdown',
            content: enContent,
            i18n_content: { zh_cn: zhContent, en_us: enContent },
            text_size: 'notation',
        },
    ];
}
function compactNumber(value) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
        const m = value / 1_000_000;
        return Math.abs(m) >= 100 ? `${Math.round(m)}m` : `${m.toFixed(1)}m`;
    }
    if (abs >= 1_000) {
        const k = value / 1_000;
        return Math.abs(k) >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return `${Math.round(value)}`;
}
function formatFooterRuntimeSegments(params) {
    const { footer, metrics, elapsedMs, isError, isAborted } = params;
    const primaryZh = [];
    const primaryEn = [];
    const detailZh = [];
    const detailEn = [];
    // --- Primary line: status, elapsed, model ---
    if (footer?.status) {
        if (isError) {
            primaryZh.push('出错');
            primaryEn.push('Error');
        }
        else if (isAborted) {
            primaryZh.push('已停止');
            primaryEn.push('Stopped');
        }
        else {
            primaryZh.push('已完成');
            primaryEn.push('Completed');
        }
    }
    if (footer?.elapsed && elapsedMs != null) {
        const d = formatElapsed(elapsedMs);
        primaryZh.push(`耗时 ${d}`);
        primaryEn.push(`Elapsed ${d}`);
    }
    if (footer?.model && metrics?.model) {
        const model = metrics.model.trim();
        if (model) {
            primaryZh.push(model);
            primaryEn.push(model);
        }
    }
    if (footer?.provider && metrics?.provider) {
        const provider = metrics.provider.trim();
        if (provider) {
            primaryZh.push(provider);
            primaryEn.push(provider);
        }
    }
    // --- Detail line: tokens, cache, context ---
    if (footer?.tokens && metrics) {
        const inTokens = typeof metrics.inputTokens === 'number' ? Math.max(0, metrics.inputTokens) : undefined;
        const outTokens = typeof metrics.outputTokens === 'number' ? Math.max(0, metrics.outputTokens) : undefined;
        if (inTokens != null && outTokens != null) {
            const inLabel = compactNumber(inTokens);
            const outLabel = compactNumber(outTokens);
            detailZh.push(`↑ ${inLabel} ↓ ${outLabel}`);
            detailEn.push(`↑ ${inLabel} ↓ ${outLabel}`);
        }
    }
    if (footer?.cache && metrics) {
        const read = typeof metrics.cacheRead === 'number' ? Math.max(0, metrics.cacheRead) : undefined;
        const write = typeof metrics.cacheWrite === 'number' ? Math.max(0, metrics.cacheWrite) : undefined;
        const inputVal = typeof metrics.inputTokens === 'number' ? Math.max(0, metrics.inputTokens) : undefined;
        if (read != null && write != null && inputVal != null) {
            const total = read + write + inputVal;
            const hit = total > 0 ? Math.round((read / total) * 100) : 0;
            const left = compactNumber(read);
            const right = compactNumber(write);
            detailZh.push(`缓存 ${left}/${right} (${hit}%)`);
            detailEn.push(`Cache ${left}/${right} (${hit}%)`);
        }
    }
    if (footer?.context && metrics) {
        const freshTotal = metrics.totalTokensFresh === false ? undefined : metrics.totalTokens;
        const total = typeof freshTotal === 'number' ? Math.max(0, freshTotal) : undefined;
        const ctx = typeof metrics.contextTokens === 'number' ? Math.max(0, metrics.contextTokens) : undefined;
        if (total != null && ctx != null) {
            const totalLabel = compactNumber(total);
            const ctxLabel = compactNumber(ctx);
            const pct = ctx > 0 ? Math.round((total / ctx) * 100) : 0;
            const pctLabel = `${pct}%`;
            detailZh.push(`上下文 ${totalLabel}/${ctxLabel} (${pctLabel})`);
            detailEn.push(`Context ${totalLabel}/${ctxLabel} (${pctLabel})`);
        }
    }
    return { primaryZh, primaryEn, detailZh, detailEn };
}
// ---------------------------------------------------------------------------
// buildCardContent
// ---------------------------------------------------------------------------
/**
 * Build a full Feishu Interactive Message Card JSON object for the
 * given state.
 */
function buildCardContent(state, data = {}) {
    switch (state) {
        case 'thinking':
            return buildThinkingCard();
        case 'streaming':
            return buildStreamingCard(data.text ?? '', {
                reasoningText: data.reasoningText,
                showToolUse: data.showToolUse,
                toolUseSteps: data.toolUseSteps,
                toolUseTitleSuffix: data.toolUseTitleSuffix,
            });
        case 'complete':
            return buildCompleteCard({
                text: data.text ?? '',
                elapsedMs: data.elapsedMs,
                isError: data.isError,
                reasoningText: data.reasoningText,
                reasoningElapsedMs: data.reasoningElapsedMs,
                toolUseSteps: data.toolUseSteps,
                toolUseTitleSuffix: data.toolUseTitleSuffix,
                toolUseElapsedMs: data.toolUseElapsedMs,
                showToolUse: data.showToolUse,
                isAborted: data.isAborted,
                footer: data.footer,
                footerMetrics: data.footerMetrics,
            });
        case 'confirm':
            return buildConfirmCard(data.confirmData);
        default:
            throw new Error(`Unknown card state: ${state}`);
    }
}
// ---------------------------------------------------------------------------
// Private card builders
// ---------------------------------------------------------------------------
function buildThinkingCard() {
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'] },
        elements: [
            {
                tag: 'markdown',
                content: 'Thinking...',
                i18n_content: { zh_cn: '思考中...', en_us: 'Thinking...' },
            },
        ],
    };
}
function buildStreamingCard(partialText, params = {}) {
    const { showToolUse = true, toolUseSteps, toolUseTitleSuffix, reasoningText } = params;
    const elements = [];
    const hasToolUse = Boolean(toolUseSteps?.length);
    if (showToolUse) {
        elements.push(hasToolUse
            ? buildToolUsePanel({
                toolUseSteps,
                titleSuffix: toolUseTitleSuffix,
            })
            : buildStreamingToolUsePendingPanel());
    }
    if (!partialText && reasoningText) {
        // Reasoning phase: show reasoning content in notation style
        elements.push({
            tag: 'markdown',
            content: `💭 **Thinking...**\n\n${reasoningText}`,
            i18n_content: {
                zh_cn: `💭 **思考中...**\n\n${reasoningText}`,
                en_us: `💭 **Thinking...**\n\n${reasoningText}`,
            },
            text_size: 'notation',
        });
    }
    else if (partialText) {
        // Answer phase: show answer content only
        elements.push({
            tag: 'markdown',
            content: (0, markdown_style_1.optimizeMarkdownStyle)(partialText),
        });
    }
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'] },
        elements,
    };
}
function buildCompleteCard(params) {
    const { text, elapsedMs, isError, reasoningText, reasoningElapsedMs, toolUseSteps, toolUseTitleSuffix, toolUseElapsedMs, showToolUse = true, isAborted, footer, footerMetrics, } = params;
    const elements = [];
    if (showToolUse) {
        elements.push(buildToolUsePanel({
            toolUseSteps,
            toolUseElapsedMs,
            titleSuffix: toolUseTitleSuffix,
        }));
    }
    // Collapsible reasoning panel (before main content)
    if (reasoningText) {
        const dur = reasoningElapsedMs ? formatReasoningDuration(reasoningElapsedMs) : null;
        const zhLabel = dur ? dur.zh : '思考';
        const enLabel = dur ? dur.en : 'Thought';
        elements.push({
            tag: 'collapsible_panel',
            expanded: false,
            header: {
                title: {
                    tag: 'markdown',
                    content: `💭 ${enLabel}`,
                    i18n_content: {
                        zh_cn: `💭 ${zhLabel}`,
                        en_us: `💭 ${enLabel}`,
                    },
                },
                vertical_align: 'center',
                icon: {
                    tag: 'standard_icon',
                    token: 'down-small-ccm_outlined',
                    size: '16px 16px',
                },
                icon_position: 'follow_text',
                icon_expanded_angle: -180,
            },
            border: { color: 'grey', corner_radius: '5px' },
            vertical_spacing: '8px',
            padding: '8px 8px 8px 8px',
            elements: [
                {
                    tag: 'markdown',
                    content: reasoningText,
                    text_size: 'notation',
                },
            ],
        });
    }
    // Full text content
    elements.push({
        tag: 'markdown',
        content: (0, markdown_style_1.optimizeMarkdownStyle)(text),
    });
    // Footer meta-info: split into two lines for readability.
    // Line 1 (primary): status · elapsed · model
    // Line 2 (detail):  tokens · cache · context
    const fp = formatFooterRuntimeSegments({
        footer,
        metrics: footerMetrics,
        elapsedMs,
        isError,
        isAborted,
    });
    const footerZhLines = [];
    const footerEnLines = [];
    if (fp.primaryZh.length > 0) {
        footerZhLines.push(fp.primaryZh.join(' · '));
        footerEnLines.push(fp.primaryEn.join(' · '));
    }
    if (fp.detailZh.length > 0) {
        footerZhLines.push(fp.detailZh.join(' · '));
        footerEnLines.push(fp.detailEn.join(' · '));
    }
    if (footerZhLines.length > 0) {
        elements.push(...buildFooter(footerZhLines.join('\n'), footerEnLines.join('\n'), isError));
    }
    // Use the answer text as the feed preview summary.
    // Strip markdown syntax so the preview reads as plain text.
    const summaryText = text.replace(/[*_`#>[\]()~]/g, '').trim();
    const summary = summaryText ? { content: summaryText.slice(0, 120) } : undefined;
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'], summary },
        elements,
    };
}
function buildConfirmCard(confirmData) {
    const elements = [];
    // Operation description
    elements.push({
        tag: 'div',
        text: {
            tag: 'lark_md',
            content: confirmData.operationDescription,
        },
    });
    // Preview (if available)
    if (confirmData.preview) {
        elements.push({ tag: 'hr' });
        elements.push({
            tag: 'div',
            text: {
                tag: 'lark_md',
                content: `**Preview:**\n${confirmData.preview}`,
            },
        });
    }
    // Confirm / Reject / Preview buttons
    elements.push({ tag: 'hr' });
    elements.push({
        tag: 'action',
        actions: [
            {
                tag: 'button',
                text: { tag: 'plain_text', content: 'Confirm' },
                type: 'primary',
                value: {
                    action: 'confirm_write',
                    operation_id: confirmData.pendingOperationId,
                },
            },
            {
                tag: 'button',
                text: { tag: 'plain_text', content: 'Reject' },
                type: 'danger',
                value: {
                    action: 'reject_write',
                    operation_id: confirmData.pendingOperationId,
                },
            },
            ...(confirmData.preview
                ? []
                : [
                    {
                        tag: 'button',
                        text: {
                            tag: 'plain_text',
                            content: 'Preview',
                        },
                        type: 'default',
                        value: {
                            action: 'preview_write',
                            operation_id: confirmData.pendingOperationId,
                        },
                    },
                ]),
        ],
    });
    return {
        config: { wide_screen_mode: true, update_multi: true },
        header: {
            title: {
                tag: 'plain_text',
                content: '\ud83d\udd12 Confirmation Required',
            },
            template: 'orange',
        },
        elements,
    };
}
// ---------------------------------------------------------------------------
// toCardKit2
// ---------------------------------------------------------------------------
/**
 * Convert an old-format FeishuCard to CardKit JSON 2.0 format.
 * JSON 2.0 uses `body.elements` instead of top-level `elements`.
 */
/**
 * Build the initial CardKit 2.0 streaming card with a loading icon.
 * Optionally includes a tool-use pending panel above the streaming area.
 */
function buildStreamingThinkingCard(showToolUse = true) {
    return buildStreamingPreAnswerCard({ showToolUse });
}
/**
 * Build a CardKit 2.0 card for the pre-answer streaming phase.
 * Used both for the initial card and for live updates during tool calls.
 */
function buildStreamingPreAnswerCard(params) {
    const { steps, elapsedMs, showToolUse = true } = params;
    const hasSteps = Boolean(steps?.length);
    const elements = [];
    if (showToolUse) {
        elements.push(hasSteps ? buildStreamingToolUseActivePanel({ steps: steps, elapsedMs }) : buildStreamingToolUsePendingPanel());
    }
    elements.push({
        tag: 'markdown',
        content: '',
        text_align: 'left',
        text_size: 'normal_v2',
        margin: '0px 0px 0px 0px',
        element_id: exports.STREAMING_ELEMENT_ID,
    });
    elements.push({
        tag: 'markdown',
        content: ' ',
        icon: {
            tag: 'custom_icon',
            img_key: 'img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg',
            size: '16px 16px',
        },
        element_id: 'loading_icon',
    });
    return {
        schema: '2.0',
        config: {
            streaming_mode: true,
            locales: ['zh_cn', 'en_us'],
            summary: {
                content: 'Processing...',
                i18n_content: { zh_cn: '处理中...', en_us: 'Processing...' },
            },
        },
        body: { elements },
    };
}
/**
 * Build the collapsible panel for the active pre-answer phase.
 * Used by buildStreamingPreAnswerCard when at least one step exists.
 */
function buildStreamingToolUseActivePanel(params) {
    const { steps, elapsedMs } = params;
    const enParts = ['Tool use'];
    const zhParts = ['工具执行'];
    if (steps.length > 0) {
        enParts.push(`${steps.length} step${steps.length === 1 ? '' : 's'}`);
        zhParts.push(`${steps.length} 步`);
    }
    if (elapsedMs != null && elapsedMs > 0) {
        const d = formatElapsed(elapsedMs);
        enParts.push(`(${d})`);
        zhParts.push(`(${d})`);
    }
    return {
        tag: 'collapsible_panel',
        expanded: true,
        header: {
            title: {
                tag: 'plain_text',
                content: `🛠️ ${enParts.join(' · ')}`,
                i18n_content: {
                    zh_cn: `🛠️ ${zhParts.join(' · ')}`,
                    en_us: `🛠️ ${enParts.join(' · ')}`,
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: buildToolUseStepElementList(steps),
    };
}
/**
 * Build the per-step elements for a tool-use panel, capped so the whole
 * card stays under Feishu's 200-element limit.
 *
 * Each step expands to 1-3 elements, so a long agentic run (dozens of
 * tool calls) used to overflow the card and make the terminal
 * `card.update` fail with code 300305. Steps beyond the budget are
 * replaced by a single "N more steps not shown" notice.
 */
function buildToolUseStepElementList(steps, budget = TOOL_USE_STEP_ELEMENT_BUDGET) {
    if (!steps || steps.length === 0) {
        return [buildToolUsePlaceholder()];
    }
    const elements = [];
    // Reserve room for the "N more steps" notice in case we drop any step.
    const stepBudget = Math.max(budget - TOOL_USE_NOTICE_ELEMENT_COST, 0);
    let used = 0;
    let hiddenSteps = 0;
    for (const step of steps) {
        const stepElements = buildToolUseStepElements(step);
        const cost = countCardElements(stepElements);
        if (used + cost > stepBudget) {
            hiddenSteps += 1;
            continue;
        }
        elements.push(...stepElements);
        used += cost;
    }
    if (hiddenSteps > 0) {
        elements.push(buildToolUseTruncationNotice(hiddenSteps, steps.length));
    }
    if (elements.length === 0) {
        elements.push(buildToolUsePlaceholder());
    }
    return elements;
}
/** Single-element notice summarising steps dropped by the element budget. */
function buildToolUseTruncationNotice(hiddenSteps, totalSteps) {
    const zh = `… 其余 ${hiddenSteps} 步未展示（共 ${totalSteps} 步）`;
    const en = `… ${hiddenSteps} more step${hiddenSteps === 1 ? '' : 's'} not shown (${totalSteps} total)`;
    return {
        tag: 'div',
        text: {
            tag: 'plain_text',
            content: en,
            i18n_content: {
                zh_cn: zh,
                en_us: en,
            },
            text_color: 'grey',
            text_size: 'notation',
        },
    };
}
function toCardKit2(card) {
    const result = {
        schema: '2.0',
        config: card.config,
        body: { elements: card.elements },
    };
    if (card.header)
        result.header = card.header;
    return result;
}
// ---------------------------------------------------------------------------
// Card budget helpers (Feishu hard limits: 200 elements / 30KB)
// ---------------------------------------------------------------------------
/** Recursively count every node carrying a `tag` (elements/components). */
function countCardElements(card) {
    let total = 0;
    const visit = (node) => {
        if (node == null || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item);
            return;
        }
        if (typeof node.tag === 'string')
            total += 1;
        for (const key of Object.keys(node))
            visit(node[key]);
    };
    visit(card);
    return total;
}
/** Serialized UTF-8 byte size of a card, as Feishu measures it. */
function estimateCardBytes(card) {
    try {
        return Buffer.byteLength(JSON.stringify(card), 'utf8');
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
}
/**
 * Build the terminal (complete) card while respecting Feishu's hard limits.
 *
 * The old code built the card unconditionally and relied on a `try/catch`
 * around `card.update`. On a long agentic run that update always failed
 * (300305: >200 components / 200860: >30KB) and the catch only logged a
 * warning, so the answer never reached the user. This helper degrades the
 * card step by step instead:
 *
 *   1. everything (fast path — identical to the previous output)
 *   2. clip the reasoning panel
 *   3. drop the reasoning panel
 *   4. drop the reasoning panel and the tool-use panel
 *   5. also clip the answer text (last resort)
 *
 * Returns `{ card, truncatedText }`. When `truncatedText` is true the
 * visible answer was shortened, so the caller MUST deliver the full text
 * through a separate channel (plain-text message) to avoid losing content.
 */
function buildBoundedCompleteCard(params, opts = {}) {
    const maxBytes = opts.maxBytes ?? CARD_SIZE_BUDGET_BYTES;
    const reasoningChars = opts.reasoningChars ?? REASONING_MAX_CHARS;
    const answerChars = opts.answerChars ?? ANSWER_MAX_CHARS_BUDGET;
    const fullText = params.text ?? '';
    const attempts = [
        { reasoning: Number.POSITIVE_INFINITY, answer: Number.POSITIVE_INFINITY, showToolUse: params.showToolUse },
        { reasoning: reasoningChars, answer: Number.POSITIVE_INFINITY, showToolUse: params.showToolUse },
        { reasoning: 0, answer: Number.POSITIVE_INFINITY, showToolUse: params.showToolUse },
        { reasoning: 0, answer: Number.POSITIVE_INFINITY, showToolUse: false },
        { reasoning: 0, answer: answerChars, showToolUse: false },
    ];
    let card;
    let truncatedText = false;
    for (const attempt of attempts) {
        card = buildCompleteCard({
            ...params,
            showToolUse: attempt.showToolUse,
            reasoningText: clipText(params.reasoningText, attempt.reasoning),
            text: clipText(fullText, attempt.answer),
        });
        truncatedText = Number.isFinite(attempt.answer) && fullText.length > attempt.answer;
        if (estimateCardBytes(card) <= maxBytes && countCardElements(card) <= CARD_ELEMENT_LIMIT) {
            return { card, truncatedText };
        }
    }
    return { card, truncatedText };
}
function buildStreamingToolUsePendingPanel() {
    return {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
            title: {
                tag: 'plain_text',
                content: '🛠️ Tool use pending',
                i18n_content: {
                    zh_cn: '🛠️ 等待工具执行',
                    en_us: '🛠️ Tool use pending',
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: [],
    };
}
function buildToolUsePanel(params) {
    const { toolUseSteps = [], toolUseElapsedMs, titleSuffix } = params;
    const duration = toolUseElapsedMs ? formatToolUseDuration(toolUseElapsedMs) : null;
    const zhTitleParts = [duration?.zh ?? '工具执行'];
    const enTitleParts = [duration?.en ?? 'Tool use'];
    if (titleSuffix) {
        zhTitleParts.push(titleSuffix.zh);
        enTitleParts.push(titleSuffix.en);
    }
    const stepElements = buildToolUseStepElementList(toolUseSteps);
    return {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
            title: {
                tag: 'plain_text',
                content: `🛠️ ${enTitleParts.join(' · ')}`,
                i18n_content: {
                    zh_cn: `🛠️ ${zhTitleParts.join(' · ')}`,
                    en_us: `🛠️ ${enTitleParts.join(' · ')}`,
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: stepElements,
    };
}
function buildToolUseStepElements(step) {
    const elements = [buildToolUseStepTitleElement(step)];
    const detailElement = buildToolUseStepDetailElement(step);
    if (detailElement) {
        elements.push(detailElement);
    }
    const outputElement = buildToolUseStepOutputElement(step);
    if (outputElement) {
        elements.push(outputElement);
    }
    return elements;
}
function buildToolUsePlaceholder(labels) {
    const zh = labels?.zh ?? '暂无工具步骤';
    const en = labels?.en ?? tool_use_display_1.EMPTY_TOOL_USE_PLACEHOLDER;
    return {
        tag: 'div',
        text: {
            tag: 'plain_text',
            content: en,
            i18n_content: {
                zh_cn: zh,
                en_us: en,
            },
            text_color: 'grey',
            text_size: 'notation',
        },
    };
}
function buildToolUseStepTitleElement(step) {
    return {
        tag: 'div',
        icon: {
            tag: 'standard_icon',
            token: step.iconToken,
            color: 'grey',
        },
        text: {
            tag: 'lark_md',
            content: buildToolUseStepTitleMarkdown(step),
            text_size: 'notation',
        },
    };
}
function buildToolUseStepTitleMarkdown(step) {
    const status = formatToolUseStepStatus(step.status);
    return (0, markdown_style_1.optimizeMarkdownStyle)(`**${escapeToolUseMarkdownText(step.title)}** · <font color='${status.color}'>${status.label}</font>`, 1);
}
function buildToolUseStepDetailElement(step) {
    const detail = step.detail?.trim();
    if (!detail)
        return undefined;
    return {
        tag: 'div',
        margin: TOOL_USE_STEP_CONTENT_INDENT,
        text: {
            tag: 'plain_text',
            content: detail,
            text_color: 'grey',
            text_size: 'notation',
        },
    };
}
function buildToolUseStepOutputElement(step) {
    const content = buildToolUseStepOutputMarkdown(step);
    if (!content)
        return undefined;
    return {
        tag: 'div',
        margin: TOOL_USE_STEP_CONTENT_INDENT,
        text: {
            tag: 'lark_md',
            content,
            text_size: 'notation',
        },
    };
}
function buildToolUseStepOutputMarkdown(step) {
    const lines = [];
    if (step.errorBlock) {
        lines.push('**Error**');
        lines.push(formatToolUseCodeBlock(clipText(step.errorBlock.content, TOOL_USE_OUTPUT_MAX_CHARS), step.errorBlock.language));
    }
    else if (step.resultBlock) {
        lines.push('**Result**');
        lines.push(formatToolUseCodeBlock(clipText(step.resultBlock.content, TOOL_USE_OUTPUT_MAX_CHARS), step.resultBlock.language));
    }
    if (lines.length === 0)
        return undefined;
    return (0, markdown_style_1.optimizeMarkdownStyle)(lines.join('\n'), 1);
}
/**
 * Clip a text to `maxChars`, appending a marker so the reader knows it was
 * shortened. `maxChars <= 0` removes the text entirely.
 */
function clipText(text, maxChars) {
    if (typeof text !== 'string' || !text)
        return text;
    if (!Number.isFinite(maxChars))
        return text;
    if (maxChars <= 0)
        return undefined;
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n\n…(truncated, ${text.length - maxChars} more chars)`;
}
function formatToolUseStepStatus(status) {
    switch (status) {
        case 'running':
            return { label: 'Running', color: 'turquoise' };
        case 'error':
            return { label: 'Failed', color: 'red' };
        case 'success':
        default:
            return { label: 'Succeeded', color: 'green' };
    }
}
function formatToolUseCodeBlock(content, language) {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(normalized) + 1));
    return `${fence}${language}\n${normalized}\n${fence}`;
}
function longestBacktickRun(value) {
    const matches = value.match(/`+/g) ?? [];
    return matches.reduce((max, run) => Math.max(max, run.length), 0);
}
function escapeToolUseMarkdownText(value) {
    return value.replace(/\\/g, '\\\\').replace(/([`*_{}[\]<>])/g, '\\$1');
}
