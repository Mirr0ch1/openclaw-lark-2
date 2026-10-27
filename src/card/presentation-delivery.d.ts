/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-payload → Feishu card resolution.
 */
import type { ReplyPayload } from 'openclaw/plugin-sdk';
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
export type { ReplyPayload };
