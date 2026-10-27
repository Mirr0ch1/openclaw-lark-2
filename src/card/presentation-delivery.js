"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-payload → Feishu card resolution.
 *
 * Three payload shapes can carry interactive content:
 *   1. `channelData.feishu.nativeCard` — a card this plugin built itself
 *      (code-built cards keep full fidelity and skip the model-authored card
 *      sanitiser, which only allows a narrow element/button subset).
 *   2. `channelData.feishu.buttons` — the plugin's own button list, produced by
 *      the command-menu and model-picker hooks.
 *   3. `presentation` — OpenClaw's portable `MessagePresentation` payload
 *      (tables for `/status`, buttons for approvals and command menus).
 *
 * When none of them yields a card the caller falls back to plain text, using
 * core's own `renderMessagePresentationFallbackText` so the degraded output
 * matches what other channels show.
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePayloadCard = void 0;
exports.resolvePayloadCardDelivery = void 0;
exports.resolvePresentationText = void 0;
const interactive_runtime_1 = require("openclaw/plugin-sdk/interactive-runtime");
const presentation_card_1 = require("./presentation-card.js");
/**
 * Resolve a reply payload to a Feishu interactive card.
 *
 * @param {unknown} payload A core reply payload.
 * @returns {Record<string, unknown> | undefined} The card, or undefined when the
 * payload carries nothing that can be rendered as a card.
 */
function resolvePayloadCard(payload) {
    return resolvePayloadCardDelivery(payload).card;
}
exports.resolvePayloadCard = resolvePayloadCard;
/**
 * Resolve a reply payload to a card plus the text that has to accompany it.
 *
 * `presentationTextMode: "fallback"` means the payload's text is the *exact
 * fallback* for the presentation, not additional content — so it is dropped
 * once the card renders the same information. Core does the same on the
 * outbound path (`presentation-delivery.ts` clears `text` in that case).
 *
 * @returns {{ card?: Record<string, unknown>, text: string }}
 */
function resolvePayloadCardDelivery(payload) {
    const empty = { text: '' };
    if (!payload || typeof payload !== 'object')
        return empty;
    const channelData = payload.channelData;
    const feishuData = channelData && typeof channelData === 'object' && !Array.isArray(channelData)
        ? channelData.feishu
        : undefined;
    const payloadText = typeof payload.text === 'string' ? payload.text : '';
    if (feishuData && typeof feishuData === 'object' && !Array.isArray(feishuData)) {
        // Code-built card: trusted, never passed through the sanitiser.
        if (feishuData.nativeCard && typeof feishuData.nativeCard === 'object' && !Array.isArray(feishuData.nativeCard)) {
            return { card: feishuData.nativeCard, text: payloadText };
        }
        // Plugin-native button list (command menu / model picker). The card
        // carries the prompt text itself, so nothing is sent alongside it.
        if (Array.isArray(feishuData.buttons) && feishuData.buttons.length > 0) {
            const card = (0, presentation_card_1.buildFeishuButtonsCard)({
                text: payloadText,
                buttons: feishuData.buttons,
                buttonsPerRow: feishuData.buttonsPerRow,
            });
            if (card)
                return { card, text: '' };
        }
    }
    // Portable presentation blocks.
    const presentation = (0, interactive_runtime_1.normalizeMessagePresentation)(payload.presentation);
    if (!presentation)
        return { text: payloadText };
    const card = (0, presentation_card_1.buildPresentationCard)(presentation);
    if (!card)
        return { text: payloadText };
    const textIsFallback = payload.presentationTextMode === 'fallback';
    return { card, text: textIsFallback ? '' : payloadText };
}
exports.resolvePayloadCardDelivery = resolvePayloadCardDelivery;
/**
 * Plain-text rendering of a payload's presentation, used when the card path
 * is unavailable (card too large, or the user is in a chat that cannot render
 * cards).
 */
function resolvePresentationText(payload) {
    const presentation = (0, interactive_runtime_1.normalizeMessagePresentation)(payload?.presentation);
    if (!presentation)
        return undefined;
    const text = (0, interactive_runtime_1.renderMessagePresentationFallbackText)({ presentation });
    return text?.trim() ? text : undefined;
}
