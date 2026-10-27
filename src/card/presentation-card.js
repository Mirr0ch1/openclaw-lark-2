"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Portable OpenClaw `MessagePresentation` → Feishu interactive card.
 *
 * OpenClaw core produces channel-agnostic presentations:
 *   - `/status` emits a `table` block ("Session status", headers ["Item","Value"])
 *     plus low-emphasis `context` blocks;
 *   - approvals / ask-user / provider login emit `buttons` blocks;
 *   - command menus emit `select` blocks.
 *
 * Core adapts those blocks to the capabilities the channel declares
 * (`ChannelOutboundAdapter.presentationCapabilities`) and then calls the
 * channel's optional `renderPresentation` hook. Without that hook core falls
 * back to `renderMessagePresentationFallbackText`, i.e. plain text — which is
 * what Feishu used to receive.
 *
 * This module is the Feishu side of that contract:
 *   - `text`     → `markdown` element
 *   - `context`  → `markdown` element in notation (small) size
 *   - `divider`  → `hr` element
 *   - `table`    → `markdown` element holding a GFM table (Feishu renders it)
 *   - `buttons`  → a `column_set` row of `button` elements
 *   - `select`   → a `column_set` row with one button per option
 *
 * The cards are Feishu Card JSON 2.0 (`schema: "2.0"`). In that dialect the
 * `action` element does not exist — a `button` is a top-level component and a
 * row of buttons is a `column_set` of `column`s, the same layout the plugin's
 * ask-user card uses.
 *
 * Feishu has no native menu control, so `select` blocks become a button row
 * (the same strategy the Telegram channel uses).
 *
 * Button actions map onto the plugin's own card-action vocabulary:
 *   - `command` → `{ action: "inject_prompt", prompt }` — clicking it dispatches
 *     the command text as a synthetic user message (see
 *     `channel/event-handlers.js#handleInjectPromptAction`).
 *   - `url`     → a Feishu `open_url` button behaviour.
 *   - everything else (approval / question / callback / model-picker) is
 *     *opaque*: the payload was addressed to another channel's transport, so
 *     the control is rendered label-only instead of guessing a behaviour.
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.FEISHU_PRESENTATION_CAPABILITIES = void 0;
exports.buildFeishuButtonsCard = void 0;
exports.buildPresentationCard = void 0;
exports.resolvePresentationButtonAction = void 0;
const markdown_style_1 = require("./markdown-style.js");
const card_error_1 = require("./card-error.js");
const builder_1 = require("./builder.js");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Channel capabilities advertised to OpenClaw core for Feishu.
 *
 * `tables: true` — Feishu renders markdown tables inside card `markdown`
 * elements (up to FEISHU_CARD_TABLE_LIMIT tables per card).
 * `buttons: true` — Feishu cards support `action` rows with `button` elements.
 * `selects: true` — no native menu control, but select blocks are rendered as
 * a button row, so the options stay interactive.
 * `charts: false` — no native chart element; core downgrades charts to text.
 * `divider: true` — Feishu cards have an `hr` element.
 */
exports.FEISHU_PRESENTATION_CAPABILITIES = {
    supported: true,
    buttons: true,
    selects: true,
    context: true,
    divider: true,
    charts: false,
    tables: true,
    limits: {
        actions: {
            maxActions: 20,
            maxActionsPerRow: 3,
            maxLabelLength: 30,
            supportsStyles: true,
            supportsDisabled: false,
        },
        selects: { maxOptions: 20 },
        text: { maxLength: 4000, markdownDialect: "markdown" },
    },
};
const FEISHU_PRESENTATION_CAPABILITIES = exports.FEISHU_PRESENTATION_CAPABILITIES;
/** Feishu renders at most a few markdown tables per card (empirically 3). */
const MAX_TABLES_PER_CARD = card_error_1.FEISHU_CARD_TABLE_LIMIT;
/** Cards are hard-capped by Feishu at 200 elements and 30 KB of JSON. */
const CARD_ELEMENT_LIMIT = builder_1.CARD_ELEMENT_LIMIT;
const CARD_SIZE_LIMIT_BYTES = builder_1.CARD_SIZE_LIMIT_BYTES;
/** Leave headroom under Feishu's hard limits for JSON escaping overhead. */
const CARD_BUDGET_BYTES = 28 * 1024;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Escape one markdown table cell.
 *
 * Pipes must be escaped or they split the cell, and newlines would break the
 * row into two. Backslashes are escaped first so the escape itself is literal.
 */
function escapeMarkdownCell(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ")
        .trim();
}
/**
 * Render a portable table block as a GFM table.
 *
 * Feishu renders markdown tables inside card `markdown` elements; the plugin's
 * own markdown normaliser adds the blank lines Feishu needs around a table.
 */
function buildMarkdownTable(block) {
    const headers = Array.isArray(block?.headers) ? block.headers : [];
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    if (headers.length === 0 && rows.length === 0)
        return '';
    const lines = [];
    const caption = typeof block?.caption === 'string' ? block.caption.trim() : '';
    if (caption)
        lines.push(`**${escapeMarkdownCell(caption)}**`, '');
    if (headers.length > 0) {
        lines.push(`| ${headers.map(escapeMarkdownCell).join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    }
    for (const row of rows) {
        const cells = Array.isArray(row) ? row : [row];
        lines.push(`| ${cells.map(escapeMarkdownCell).join(' | ')} |`);
    }
    return lines.join('\n');
}
/**
 * Resolve the transport behaviour of a portable button.
 *
 * @returns {{ kind: "inject" | "url" | "opaque", prompt?: string, url?: string, value?: string }}
 */
function resolvePresentationButtonAction(button) {
    const action = button?.action;
    if (action && typeof action === 'object' && typeof action.type === 'string') {
        if (action.type === 'command' && typeof action.command === 'string' && action.command.trim()) {
            return { kind: 'inject', prompt: action.command.trim() };
        }
        if (action.type === 'url' && typeof action.url === 'string' && action.url.trim()) {
            return { kind: 'url', url: action.url.trim() };
        }
        // approval / question / callback / model-picker carry transport data
        // addressed to a specific channel — never guess a behaviour here.
        return { kind: 'opaque' };
    }
    if (typeof button?.url === 'string' && button.url.trim())
        return { kind: 'url', url: button.url.trim() };
    if (typeof button?.value === 'string' && button.value.trim())
        return { kind: 'opaque', value: button.value.trim() };
    return { kind: 'opaque' };
}
exports.resolvePresentationButtonAction = resolvePresentationButtonAction;
/** Feishu button type for a portable button style hint. */
function resolveFeishuButtonType(style) {
    if (style === 'primary' || style === 'success')
        return 'primary';
    if (style === 'danger')
        return 'danger';
    return 'default';
}
/** Feishu only accepts http(s) URLs. */
function resolveSafeUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Build one Feishu button element from a portable button.
 *
 * @returns {Record<string, unknown> | undefined} The button, or undefined when
 * the control cannot be made interactive (the caller renders it as text).
 */
function buildButtonElement(button) {
    const label = typeof button?.label === 'string' ? button.label.trim() : '';
    if (!label)
        return undefined;
    const action = resolvePresentationButtonAction(button);
    if (action.kind === 'inject') {
        return {
            tag: 'button',
            text: { tag: 'plain_text', content: label },
            type: resolveFeishuButtonType(button.style),
            value: { action: 'inject_prompt', prompt: action.prompt },
        };
    }
    if (action.kind === 'url') {
        const safeUrl = resolveSafeUrl(action.url);
        if (!safeUrl)
            return undefined;
        return {
            tag: 'button',
            text: { tag: 'plain_text', content: label },
            type: resolveFeishuButtonType(button.style),
            behaviors: [{ type: 'open_url', default_url: safeUrl }],
        };
    }
    return undefined;
}
/** Chunk buttons into rows of at most `size` entries. */
function chunkButtons(buttons, size) {
    const rows = [];
    for (let index = 0; index < buttons.length; index += size) {
        rows.push(buttons.slice(index, index + size));
    }
    return rows;
}
/**
 * Lay a row of buttons out as a Feishu v2 `column_set`.
 *
 * Card JSON 2.0 has no `action` wrapper — that is a v1 element. In v2 a
 * `button` is a top-level component, and a row of buttons is expressed as a
 * `column_set` whose columns each hold one button (the same layout the
 * plugin's ask-user card uses).
 */
function buildButtonRow(buttons) {
    return {
        tag: 'column_set',
        flex_mode: 'stretch',
        columns: buttons.map((button) => ({
            tag: 'column',
            width: 'weighted',
            weight: 1,
            vertical_align: 'center',
            elements: [button],
        })),
    };
}
// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------
/**
 * Build a Feishu interactive card from a portable presentation.
 *
 * @param {unknown} presentation A normalised `MessagePresentation`.
 * @returns {Record<string, unknown> | undefined} The card, or undefined when
 * the presentation carries nothing renderable.
 */
function buildPresentationCard(presentation) {
    const blocks = Array.isArray(presentation?.blocks) ? presentation.blocks : [];
    if (blocks.length === 0)
        return undefined;
    const elements = [];
    const opaqueLabels = [];
    let tableCount = 0;
    for (const block of blocks) {
        if (!block || typeof block !== 'object')
            continue;
        switch (block.type) {
            case 'text':
            case 'context': {
                const text = typeof block.text === 'string' ? block.text : '';
                if (!text.trim())
                    break;
                elements.push({
                    tag: 'markdown',
                    content: (0, markdown_style_1.optimizeMarkdownStyle)(text),
                    ...block.type === 'context' ? { text_size: 'notation' } : {},
                });
                break;
            }
            case 'divider': {
                elements.push({ tag: 'hr' });
                break;
            }
            case 'table': {
                if (tableCount >= MAX_TABLES_PER_CARD)
                    break;
                const markdown = buildMarkdownTable(block);
                if (!markdown.trim())
                    break;
                tableCount += 1;
                elements.push({ tag: 'markdown', content: (0, markdown_style_1.optimizeMarkdownStyle)(markdown) });
                break;
            }
            case 'buttons':
            case 'select': {
                const source = block.type === 'buttons'
                    ? (Array.isArray(block.buttons) ? block.buttons : [])
                    : (Array.isArray(block.options) ? block.options : []);
                const rendered = [];
                for (const control of source) {
                    const element = buildButtonElement(control);
                    if (element)
                        rendered.push(element);
                    else if (typeof control?.label === 'string' && control.label.trim()) {
                        opaqueLabels.push(control.label.trim());
                    }
                }
                if (rendered.length === 0)
                    break;
                for (const row of chunkButtons(rendered, FEISHU_PRESENTATION_CAPABILITIES.limits.actions.maxActionsPerRow)) {
                    elements.push(buildButtonRow(row));
                }
                break;
            }
            case 'chart': {
                // `charts: false` means core downgrades charts to a text block
                // before we see them; this is a defensive fallback only.
                break;
            }
            default:
                break;
        }
    }
    // Controls that could not be made interactive are still worth showing, but
    // only as text — the same policy core applies for label-only fallbacks.
    if (opaqueLabels.length > 0) {
        elements.push({
            tag: 'markdown',
            content: opaqueLabels.map((label) => `- ${escapeMarkdownCell(label)}`).join('\n'),
            text_size: 'notation',
        });
    }
    if (elements.length === 0)
        return undefined;
    const title = typeof presentation?.title === 'string' ? presentation.title.trim() : '';
    const card = {
        schema: '2.0',
        config: { width_mode: 'fill', update_multi: true },
        ...title ? { header: { title: { tag: 'plain_text', content: title }, template: 'blue' } } : {},
        body: { elements },
    };
    return fitsCardBudget(card) ? card : undefined;
}
exports.buildPresentationCard = buildPresentationCard;
/**
 * Build a Feishu card that carries a row of buttons.
 *
 * Used by the command argument menu and the model picker: every button
 * injects its command text as a synthetic user message.
 *
 * @param {{ title?: string, text?: string, buttonsPerRow?: number, buttons?: Array<{ label: string, prompt: string }> }} params
 */
function buildFeishuButtonsCard(params) {
    const buttons = (Array.isArray(params?.buttons) ? params.buttons : [])
        .filter((entry) => entry && typeof entry.label === 'string' && entry.label.trim() && typeof entry.prompt === 'string' && entry.prompt.trim())
        .map((entry) => ({
            tag: 'button',
            text: { tag: 'plain_text', content: entry.label.trim() },
            type: 'default',
            value: { action: 'inject_prompt', prompt: entry.prompt.trim() },
        }));
    if (buttons.length === 0)
        return undefined;
    const elements = [];
    const text = typeof params?.text === 'string' ? params.text.trim() : '';
    if (text) {
        elements.push({ tag: 'markdown', content: (0, markdown_style_1.optimizeMarkdownStyle)(text) });
    }
    const perRow = typeof params?.buttonsPerRow === 'number' && params.buttonsPerRow > 0
        ? params.buttonsPerRow
        : FEISHU_PRESENTATION_CAPABILITIES.limits.actions.maxActionsPerRow;
    for (const row of chunkButtons(buttons, perRow)) {
        elements.push(buildButtonRow(row));
    }
    const title = typeof params?.title === 'string' ? params.title.trim() : '';
    const card = {
        schema: '2.0',
        config: { width_mode: 'fill', update_multi: true },
        ...title ? { header: { title: { tag: 'plain_text', content: title }, template: 'blue' } } : {},
        body: { elements },
    };
    return fitsCardBudget(card) ? card : undefined;
}
exports.buildFeishuButtonsCard = buildFeishuButtonsCard;
/** Whether the card stays inside Feishu's element and byte limits. */
function fitsCardBudget(card) {
    if (builder_1.countCardElements(card) > CARD_ELEMENT_LIMIT)
        return false;
    return builder_1.estimateCardBytes(card) <= CARD_BUDGET_BYTES
        && builder_1.estimateCardBytes(card) <= CARD_SIZE_LIMIT_BYTES;
}
