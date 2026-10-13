"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Plugin doctor contract: repairs legacy `channels.feishu` config before schema
 * validation rejects it.
 *
 * The host resolves this from the package root as `doctor-contract-api.js`
 * (see `doctor-contract-artifact`), so it must stay dependency-light and must
 * not touch the network.
 *
 * Compared with the official plugin the rule set is intentionally small: this
 * plugin's schema has few retired shapes. The one shape we do normalise is
 * `webhookPath`, which the runtime now requires to be canonical (it is used
 * verbatim as an HTTP route path, and multi-account setups derive per-account
 * default paths from it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_doctor_migrations_1 = require("openclaw/plugin-sdk/runtime-doctor-migrations");
const webhook_path_1 = require("../channel/webhook-path.js");
/**
 * Whether a channel/account entry carries a non-canonical `webhookPath`.
 *
 * `accountId` must be threaded through: for a named account the canonical
 * fallback is `<base>/<accountId>` (the host ignores `accountId` in route
 * ownership), so evaluating without it would rewrite a named account to the
 * default account's path and collide the two routes.
 */
function hasLegacyWebhookPath(value, accountId) {
    const entry = (0, runtime_doctor_migrations_1.asObjectRecord)(value);
    if (!entry)
        return false;
    const path = entry.webhookPath;
    if (typeof path !== 'string')
        return false;
    return (0, webhook_path_1.normalizeFeishuWebhookPath)(path, accountId) !== path;
}
function hasLegacyWebhookPathOnAccounts(value) {
    const accounts = (0, runtime_doctor_migrations_1.asObjectRecord)((0, runtime_doctor_migrations_1.asObjectRecord)(value)?.accounts);
    if (!accounts)
        return false;
    return Object.entries(accounts).some(([accountId, account]) => hasLegacyWebhookPath(account, accountId));
}
/** Rewrite `webhookPath` on one entry to its canonical form. */
function normalizeLegacyWebhookPath(params) {
    const path = params.entry.webhookPath;
    if (typeof path !== 'string') {
        return { entry: params.entry, changed: false };
    }
    const canonical = (0, webhook_path_1.normalizeFeishuWebhookPath)(path, params.accountId);
    if (canonical === path) {
        return { entry: params.entry, changed: false };
    }
    params.changes.push(`Normalized ${params.pathPrefix}.webhookPath to its canonical HTTP request path.`);
    return { entry: { ...params.entry, webhookPath: canonical }, changed: true };
}
function normalizeFeishuLegacyConfigEntries(cfg, changes) {
    return (0, runtime_doctor_migrations_1.normalizeChannelConfigEntries)({
        cfg,
        channelId: 'feishu',
        changes,
        normalizeEntry: (params) => normalizeLegacyWebhookPath(params),
    }).config;
}
/**
 * Rules the host reports as "legacy config present" before `--fix` runs.
 * `match` only inspects; it must not mutate.
 */
const legacyConfigRules = [
    {
        path: ['channels', 'feishu'],
        message: 'channels.feishu[.accounts.<id>].webhookPath must be a canonical HTTP request path; run "openclaw doctor --fix".',
        match: (value) => hasLegacyWebhookPath(value) || hasLegacyWebhookPathOnAccounts(value),
    },
];
/**
 * Apply all Feishu config repairs. Returns the (possibly new) config plus a
 * human-readable note per change.
 */
function normalizeCompatibilityConfig({ cfg }) {
    const changes = [];
    const config = normalizeFeishuLegacyConfigEntries(cfg, changes);
    return { config, changes };
}
exports.legacyConfigRules = legacyConfigRules;
exports.normalizeCompatibilityConfig = normalizeCompatibilityConfig;
