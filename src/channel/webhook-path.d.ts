/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Canonical Feishu webhook request paths.
 */
/** Default Gateway route path for the Feishu webhook callback. */
export declare const DEFAULT_FEISHU_WEBHOOK_PATH: '/feishu/webhook';
/**
 * Canonicalise a configured webhook path. Named accounts fall back to
 * `<base>/<accountId>` because the host ignores `accountId` in route ownership.
 */
export declare function normalizeFeishuWebhookPath(raw?: unknown, accountId?: string): string;
