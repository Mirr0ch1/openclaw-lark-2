/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-payload → Feishu card resolution.
 */
import type { ReplyPayload } from 'openclaw/plugin-sdk';
/**
 * Resolve a reply payload to a Feishu interactive card.
 *
 * Returns undefined when the payload carries nothing that can be rendered as
 * a card.
 */
export declare function resolvePayloadCard(payload: unknown): Record<string, unknown> | undefined;
/**
 * Resolve a reply payload to a card plus the text that has to accompany it.
 *
 * `presentationTextMode: "fallback"` means the payload's text is the exact
 * fallback for the presentation, so it is dropped once the card renders the
 * same information.
 */
export declare function resolvePayloadCardDelivery(payload: unknown): {
    card?: Record<string, unknown>;
    text: string;
};
/**
 * Plain-text rendering of a payload's presentation, used when the card path
 * is unavailable.
 */
export declare function resolvePresentationText(payload: unknown): string | undefined;
export type { ReplyPayload };
