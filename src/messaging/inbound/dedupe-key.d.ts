/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Retry-stable inbound dedupe keys (ported from @openclaw/feishu).
 */
/** Stable retry identity for text/post messages, or `undefined` when incomplete. */
export declare function resolveTextRetryDedupeKey(event: unknown): string | undefined;
/** Resolve the dedupe key for an inbound Feishu message event. */
export declare function resolveFeishuMessageDedupeKey(event: unknown): string | undefined;
