"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Canonical Feishu webhook request paths.
 *
 * Kept in its own dependency-light module (mirroring the official
 * `webhook-path.ts`) so the doctor contract at the package root can normalise
 * `webhookPath` without pulling in the whole webhook transport.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeFeishuWebhookPath = normalizeFeishuWebhookPath;
const account_id_1 = require("openclaw/plugin-sdk/account-id");
/** Default Gateway route path for the Feishu webhook callback. */
const DEFAULT_FEISHU_WEBHOOK_PATH = '/feishu/webhook';
exports.DEFAULT_FEISHU_WEBHOOK_PATH = DEFAULT_FEISHU_WEBHOOK_PATH;
/**
 * Canonicalise a configured webhook path (leading slash, no duplicate/trailing
 * slash). An empty or whitespace-only value falls back to the default path.
 *
 * The host keys Gateway route ownership on auth+pluginId+source and ignores
 * `accountId`, so the default path is account-scoped: named accounts get
 * `<base>/<accountId>`. Two webhook accounts left on the same path would
 * otherwise silently share one handler.
 */
function normalizeFeishuWebhookPath(raw, accountId) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const fallback = accountId && accountId !== account_id_1.DEFAULT_ACCOUNT_ID
        ? `${DEFAULT_FEISHU_WEBHOOK_PATH}/${accountId}`
        : DEFAULT_FEISHU_WEBHOOK_PATH;
    const candidate = trimmed || fallback;
    const withLeading = candidate.startsWith('/') ? candidate : `/${candidate}`;
    const collapsed = withLeading.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}
