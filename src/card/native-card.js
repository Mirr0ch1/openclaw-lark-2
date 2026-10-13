"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Sanitisation for model-authored Feishu native cards.
 *
 * Ported from @openclaw/feishu `src/native-card.ts`.
 *
 * Card JSON can come from the model (as a fenced text body, via the
 * `message` tool's `card` param, or via `channelData.feishu.card`). Feishu
 * renders it, so untrusted fields must be neutralised before send:
 *   - button URLs are restricted to http(s) (no `javascript:` etc.);
 *   - callback values must look like our own versioned envelope (`oc === "ocf1"`);
 *   - markdown / plain text is escaped;
 *   - header templates are restricted to a known allowlist.
 * Elements we don't explicitly support are dropped; callers fall back to
 * plain text when nothing usable remains.
 *
 * Our own (code-built) cards never pass through here — they are sent via
 * `sendCardFeishu`/CardKit and keep full fidelity.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeishuCardTemplate = resolveFeishuCardTemplate;
exports.escapeFeishuCardMarkdownText = escapeFeishuCardMarkdownText;
exports.escapeFeishuCardPlainText = escapeFeishuCardPlainText;
exports.resolveSafeFeishuButtonUrl = resolveSafeFeishuButtonUrl;
exports.sanitizeNativeFeishuCard = sanitizeNativeFeishuCard;
exports.sanitizeModelAuthoredCard = sanitizeModelAuthoredCard;
const FEISHU_CARD_TEMPLATES = new Set([
    'blue', 'green', 'red', 'orange', 'purple', 'indigo', 'wathet',
    'turquoise', 'yellow', 'grey', 'carmine', 'violet', 'lime',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function resolveFeishuCardTemplate(template) {
    const normalized = typeof template === 'string' ? template.trim().toLowerCase() : '';
    return normalized && FEISHU_CARD_TEMPLATES.has(normalized) ? normalized : undefined;
}
function escapeFeishuCardMarkdownText(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function escapeFeishuCardPlainText(text) {
    return escapeFeishuCardMarkdownText(text).replace(/([\\`*_{}[\]()#+\-!|>~])/g, '\\$1');
}
function resolveSafeFeishuButtonUrl(url) {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed)
        return undefined;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : undefined;
    }
    catch {
        return undefined;
    }
}
function resolveFeishuButtonType(style) {
    return style === 'primary' || style === 'success'
        ? 'primary'
        : style === 'danger'
            ? 'danger'
            : 'default';
}
function sanitizeNativeFeishuButtonBehavior(behavior) {
    if (!isRecord(behavior))
        return undefined;
    if (behavior.type === 'open_url') {
        const safeUrl = resolveSafeFeishuButtonUrl(behavior.default_url) ?? resolveSafeFeishuButtonUrl(behavior.url);
        return safeUrl ? { type: 'open_url', default_url: safeUrl } : undefined;
    }
    if (behavior.type === 'callback' && isRecord(behavior.value) && behavior.value.oc === 'ocf1') {
        return { type: 'callback', value: behavior.value };
    }
    return undefined;
}
function sanitizeNativeFeishuCardButton(button) {
    if (!isRecord(button))
        return undefined;
    const text = isRecord(button.text) && typeof button.text.content === 'string' ? button.text.content : undefined;
    if (!text?.trim())
        return undefined;
    const behaviors = Array.isArray(button.behaviors)
        ? button.behaviors.map(sanitizeNativeFeishuButtonBehavior).filter(Boolean)
        : [];
    const rootSafeUrl = resolveSafeFeishuButtonUrl(button.url);
    if (rootSafeUrl)
        behaviors.push({ type: 'open_url', default_url: rootSafeUrl });
    if (isRecord(button.value) && button.value.oc === 'ocf1')
        behaviors.push({ type: 'callback', value: button.value });
    if (behaviors.length === 0)
        return undefined;
    return {
        tag: 'button',
        text: { tag: 'plain_text', content: text },
        type: resolveFeishuButtonType(button.type),
        behaviors,
    };
}
function sanitizeNativeFeishuCardElements(element) {
    if (!isRecord(element) || typeof element.tag !== 'string')
        return [];
    if (element.tag === 'hr')
        return [{ tag: 'hr' }];
    if (element.tag === 'markdown' && typeof element.content === 'string')
        return [{ tag: 'markdown', content: escapeFeishuCardMarkdownText(element.content) }];
    if (element.tag === 'div' && isRecord(element.text)) {
        const text = element.text;
        if ((text.tag === 'lark_md' || text.tag === 'plain_text') && typeof text.content === 'string') {
            return [{
                    tag: 'markdown',
                    content: (text.tag === 'plain_text' ? escapeFeishuCardPlainText : escapeFeishuCardMarkdownText)(text.content),
                }];
        }
        return [];
    }
    if (element.tag === 'button') {
        const button = sanitizeNativeFeishuCardButton(element);
        return button ? [button] : [];
    }
    if (element.tag === 'action' && Array.isArray(element.actions)) {
        return element.actions.map(sanitizeNativeFeishuCardButton).filter(Boolean);
    }
    return [];
}
function sanitizeNativeFeishuCard(card) {
    if (!isRecord(card))
        return undefined;
    const normalizedCard = card.type === 'interactive' && isRecord(card.card) ? card.card : card;
    const body = isRecord(normalizedCard.body) ? normalizedCard.body : undefined;
    const rawElements = Array.isArray(body?.elements)
        ? body.elements
        : Array.isArray(normalizedCard.elements)
            ? normalizedCard.elements
            : [];
    const elements = rawElements.flatMap(sanitizeNativeFeishuCardElements);
    if (elements.length === 0)
        return undefined;
    const header = isRecord(normalizedCard.header) ? normalizedCard.header : undefined;
    const title = isRecord(header?.title) && typeof header.title.content === 'string' ? header.title.content : undefined;
    return {
        schema: '2.0',
        config: { width_mode: 'fill' },
        ...(title?.trim()
            ? {
                header: {
                    title: { tag: 'plain_text', content: title },
                    template: resolveFeishuCardTemplate(typeof header?.template === 'string' ? header.template : undefined) ?? 'blue',
                },
            }
            : {}),
        body: { elements },
    };
}
/**
 * Sanitise an arbitrary model-authored card object.
 *
 * Template cards reference a server-side template and carry no inline
 * elements, so they cannot be normalised; they pass through only when they
 * carry a valid `data.template_id`, otherwise they are rejected. Everything
 * else is normalised through {@link sanitizeNativeFeishuCard}. Returns
 * `undefined` when nothing usable remains (caller should fall back to text).
 */
function sanitizeModelAuthoredCard(card) {
    if (!isRecord(card))
        return undefined;
    if (card.type === 'template') {
        const data = isRecord(card.data) ? card.data : undefined;
        return typeof data?.template_id === 'string' && data.template_id.trim() ? card : undefined;
    }
    return sanitizeNativeFeishuCard(card);
}
