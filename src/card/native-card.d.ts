/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Sanitisation for model-authored Feishu native cards (ported from @openclaw/feishu).
 */
export declare function resolveFeishuCardTemplate(template?: unknown): string | undefined;
export declare function escapeFeishuCardMarkdownText(text: string): string;
export declare function escapeFeishuCardPlainText(text: string): string;
export declare function resolveSafeFeishuButtonUrl(url: unknown): string | undefined;
export declare function sanitizeNativeFeishuCard(card: unknown): Record<string, unknown> | undefined;
/** Sanitise a model-authored card; template cards pass through; `undefined` when unusable. */
export declare function sanitizeModelAuthoredCard(card: unknown): Record<string, unknown> | undefined;
