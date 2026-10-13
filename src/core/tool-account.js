"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Per-call Feishu account routing for tools.
 *
 * Ported (trimmed) from @openclaw/feishu `src/tool-account.ts`.
 *
 * Two pieces:
 *
 * 1. `resolveFeishuToolAccount` — a single, strict account resolver used by
 *    every tool client path. An explicit `accountId` supplied by the tool
 *    caller is validated (listed / configured / enabled) and never silently
 *    falls back to the first account. Contextual and configured defaults are
 *    respected before falling back to the first usable account.
 *
 * 2. A per-tool-call parameter scope (`AsyncLocalStorage`) plus a TypeBox
 *    schema helper. `registerTool` wraps every tool's `execute` so the raw
 *    call params are readable from the client getters without threading
 *    `params` through each tool body by hand. This keeps `accountId` routing
 *    reachable for all 36 tools from a single choke point.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withFeishuToolCallParams = withFeishuToolCallParams;
exports.getFeishuToolCallParams = getFeishuToolCallParams;
exports.resolveFeishuToolAccount = resolveFeishuToolAccount;
exports.resolveContextualFeishuToolAccount = resolveContextualFeishuToolAccount;
exports.accountIdToolParameter = accountIdToolParameter;
exports.withAccountIdToolParam = withAccountIdToolParam;
const node_async_hooks_1 = require("node:async_hooks");
const typebox_1 = require("@sinclair/typebox");
const accounts_1 = require("./accounts.js");
const lark_client_1 = require("./lark-client.js");
const lark_ticket_1 = require("./lark-ticket.js");
// ---------------------------------------------------------------------------
// Per-tool-call parameter scope
// ---------------------------------------------------------------------------
const toolCallScope = new node_async_hooks_1.AsyncLocalStorage();
/**
 * Run a tool execution under its raw call params so account resolution can
 * read an explicit `accountId` without every tool passing `params` along.
 */
function withFeishuToolCallParams(params, fn) {
    const store = params && typeof params === 'object' ? params : {};
    return toolCallScope.run(store, fn);
}
/** The raw params of the tool call currently executing, if any. */
function getFeishuToolCallParams() {
    return toolCallScope.getStore();
}
// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------
/** Lowercase + trim an account id for comparison; empty becomes undefined. */
function normalizeId(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    return trimmed ? trimmed.toLowerCase() : undefined;
}
/** Read an explicit `accountId` off the tool call params. */
function readExplicitAccountId(executeParams) {
    if (!executeParams || typeof executeParams !== 'object')
        return undefined;
    const raw = executeParams.accountId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}
/**
 * Resolve the Feishu account a tool call should run against.
 *
 * Order (first match wins):
 *   1. explicit `executeParams.accountId` — validated, throws on unknown /
 *      unconfigured / disabled;
 *   2. `defaultAccountId` (the conversation's account) when configured+enabled;
 *   3. `channels.feishu.defaultAccount` when configured+enabled;
 *   4. the `accountIndex`-th enabled+configured account (default index 0).
 *
 * @throws {Error} when no usable account exists, or an explicit account is invalid.
 */
function resolveFeishuToolAccount(params) {
    const cfg = (0, lark_client_1.getResolvedConfig)(params.config);
    const ids = (0, accounts_1.getLarkAccountIds)(cfg);
    // `getLarkAccountIds` already includes the implicit default account when
    // top-level credentials exist, so a plain lookup is sufficient here.
    const findListed = (normalized) => ids.find((id) => normalizeId(id) === normalized);
    // 1. Explicit account id from the tool call.
    const explicit = readExplicitAccountId(params.executeParams);
    if (explicit) {
        const normalized = normalizeId(explicit);
        const listed = normalized ? findListed(normalized) : undefined;
        if (!listed) {
            throw new Error(`Unknown Feishu account "${explicit}". Available accounts: ${ids.join(', ')}`);
        }
        const account = (0, accounts_1.getLarkAccount)(cfg, listed);
        if (!account.configured) {
            throw new Error(`Feishu account "${listed}" is not configured (missing appId or appSecret).`);
        }
        if (!account.enabled) {
            throw new Error(`Feishu account "${listed}" is disabled.`);
        }
        return account;
    }
    // 2. Contextual account — the account the current conversation belongs to.
    const contextual = normalizeId(params.defaultAccountId);
    if (contextual) {
        const listed = findListed(contextual);
        if (listed) {
            const account = (0, accounts_1.getLarkAccount)(cfg, listed);
            if (account.enabled && account.configured)
                return account;
        }
    }
    // 3. Configured routing preference.
    const section = cfg?.channels?.feishu;
    const configuredDefault = normalizeId(section?.defaultAccount);
    if (configuredDefault) {
        const listed = findListed(configuredDefault);
        if (listed) {
            const account = (0, accounts_1.getLarkAccount)(cfg, listed);
            if (account.enabled && account.configured)
                return account;
        }
    }
    // 4. Positional fallback among usable accounts.
    const enabled = (0, accounts_1.getEnabledLarkAccounts)(cfg);
    if (enabled.length === 0) {
        throw new Error('No enabled Feishu account configured. Add appId and appSecret under channels.feishu ' +
            '(or channels.feishu.accounts.<id>) and make sure the account is enabled.');
    }
    const index = Number.isInteger(params.accountIndex) && params.accountIndex > 0 ? params.accountIndex : 0;
    if (index >= enabled.length) {
        throw new Error(`Requested account index ${index} but only ${enabled.length} enabled accounts are available`);
    }
    return enabled[index];
}
/**
 * Resolve the account for the tool call currently executing, using the ambient
 * param scope (or an explicit override) and the active LarkTicket as context.
 */
function resolveContextualFeishuToolAccount(config, accountIndex = 0, executeParams) {
    return resolveFeishuToolAccount({
        config,
        executeParams: executeParams ?? getFeishuToolCallParams(),
        defaultAccountId: (0, lark_ticket_1.getTicket)()?.accountId,
        accountIndex,
    });
}
exports.resolveContextualFeishuToolAccount = resolveContextualFeishuToolAccount;
// ---------------------------------------------------------------------------
// Schema augmentation
// ---------------------------------------------------------------------------
const ACCOUNT_ID_DESCRIPTION = '目标飞书账号 ID（多账号部署时可选）。省略时使用当前会话所属的账号。';
/** The optional TypeBox `accountId` property added to every tool schema. */
function accountIdToolParameter() {
    return typebox_1.Type.Optional(typebox_1.Type.String({ description: ACCOUNT_ID_DESCRIPTION }));
}
/** Add the optional `accountId` prop to one JSON-schema object node (idempotent). */
function augmentObjectSchema(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node))
        return node;
    if (!node.properties || typeof node.properties !== 'object')
        return node;
    if (node.properties.accountId)
        return node;
    return { ...node, properties: { ...node.properties, accountId: accountIdToolParameter() } };
}
/**
 * Return a copy of a tool `parameters` schema with an optional `accountId`
 * added to every object variant (unions are mapped member-wise). Schemas that
 * are not plain object/union shapes are returned unchanged.
 */
function withAccountIdToolParam(parameters) {
    if (!parameters || typeof parameters !== 'object')
        return parameters;
    if (Array.isArray(parameters.anyOf)) {
        return { ...parameters, anyOf: parameters.anyOf.map(augmentObjectSchema) };
    }
    return augmentObjectSchema(parameters);
}
