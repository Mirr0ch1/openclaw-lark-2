"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu outbound session route.
 *
 * Ported from @openclaw/feishu `src/session-route.ts` (openclaw main 2f620b9).
 *
 * Core calls `messaging.resolveOutboundSessionRoute(...)` when it has an
 * outbound target (`feishu:ou_…`, `chat:oc_…`, …) and needs the session route:
 * which session owns it, whether the recipient id identifies the session
 * exactly, and which peer/chatType to use.
 *
 * The two `channel-core` helpers this needs are resolved lazily and guarded, so
 * a core that predates them degrades to "unsupported" instead of failing the
 * whole plugin load (the package advertises OpenClaw >= 2026.8.1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFeishuOutboundSessionRouteSupported = isFeishuOutboundSessionRouteSupported;
exports.resolveFeishuOutboundSessionRoute = resolveFeishuOutboundSessionRoute;
const accounts_1 = require("./accounts.js");
const conversation_id_1 = require("./conversation-id.js");
const targets_1 = require("./targets.js");
const policy_1 = require("../messaging/inbound/policy.js");
let helpersResolved = false;
let helpers = null;
/** Resolve (once) the channel-core helpers; `null` when this core lacks them. */
function loadChannelCoreHelpers() {
    if (helpersResolved)
        return helpers;
    helpersResolved = true;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('openclaw/plugin-sdk/channel-core');
        const stripChannelTargetPrefix = mod?.stripChannelTargetPrefix;
        const buildChannelOutboundSessionRoute = mod?.buildChannelOutboundSessionRoute;
        helpers = typeof stripChannelTargetPrefix === 'function' &&
            typeof buildChannelOutboundSessionRoute === 'function'
            ? { stripChannelTargetPrefix, buildChannelOutboundSessionRoute }
            : null;
    }
    catch {
        helpers = null;
    }
    return helpers;
}
/** Whether the host exposes the channel-core helpers this route needs. */
function isFeishuOutboundSessionRouteSupported() {
    return loadChannelCoreHelpers() !== null;
}
/** Resolve the outbound session route for a Feishu target. */
function resolveFeishuOutboundSessionRoute(params) {
    const loaded = loadChannelCoreHelpers();
    if (!loaded)
        return null;
    const rawTarget = loaded.stripChannelTargetPrefix(params.target, 'feishu', 'lark');
    const target = (0, targets_1.normalizeFeishuTarget)(rawTarget);
    if (!target) {
        return null;
    }
    const isGroup = (0, targets_1.resolveReceiveIdType)(rawTarget) === 'chat_id';
    const account = (0, accounts_1.getLarkAccount)(params.cfg, params.accountId);
    const groupSessionScope = isGroup
        ? (0, conversation_id_1.resolveConfiguredFeishuGroupSessionScope)({
            // Uses the wildcard-aware lookup: `groups["*"]` is the documented
            // "default for every group" entry, so a scope set there must apply.
            groupConfig: (0, policy_1.resolveFeishuGroupConfigWithWildcard)({ cfg: account.config, groupId: target }),
            feishuCfg: account.config,
        })
        : undefined;
    // A sender/topic-scoped inbound session cannot be recovered from a bare
    // outbound chat id, so the recipient id only identifies the session exactly
    // when the group is per-chat (or the target is a DM open id).
    const recipientSessionExact = isGroup
        ? target.startsWith('oc_') && groupSessionScope === 'group'
        : target.startsWith('ou_');
    return loaded.buildChannelOutboundSessionRoute({
        cfg: params.cfg,
        agentId: params.agentId,
        channel: 'feishu',
        accountId: params.accountId,
        recipientSessionExact,
        peer: {
            kind: isGroup ? 'group' : 'direct',
            id: target,
        },
        chatType: isGroup ? 'group' : 'direct',
        from: isGroup ? `feishu:group:${target}` : `feishu:${target}`,
        to: target,
    });
}
