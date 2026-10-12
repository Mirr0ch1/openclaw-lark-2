"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Local shims for OpenClaw plugin-SDK surface that drifted across versions:
 *
 * - readReactionParams: signature changed in 2026.3.14 (now requires a
 *   channel-specific config object). Re-exports jsonResult from the SDK.
 * - resolveSenderCommandAuthorization: OpenClaw 2026.10.1 dropped
 *   `openclaw/plugin-sdk/command-auth` (only the `-native` variant remains),
 *   so the legacy helper is ported here on top of primitives that both
 *   2026.9.x and 2026.10.x still export.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonResult = void 0;
exports.readReactionParams = readReactionParams;
exports.resolveSenderCommandAuthorization = resolveSenderCommandAuthorization;
var agent_runtime_1 = require("openclaw/plugin-sdk/agent-runtime");
var access_groups_1 = require("openclaw/plugin-sdk/access-groups");
var channel_policy_1 = require("openclaw/plugin-sdk/channel-policy");
Object.defineProperty(exports, "jsonResult", { enumerable: true, get: function () { return agent_runtime_1.jsonResult; } });
/**
 * Extract reaction parameters from raw action params.
 * Returns emoji, remove flag, and isEmpty indicator.
 */
function readReactionParams(params, opts) {
    const raw = params.emoji ?? params.reaction ?? params.type;
    const emoji = typeof raw === 'string' ? raw.trim() : '';
    const remove = Boolean(params.remove ?? params.unreact);
    const isEmpty = !emoji && !remove;
    if (remove && !emoji && opts?.removeErrorMessage) {
        throw new Error(opts.removeErrorMessage);
    }
    return { emoji, remove, isEmpty };
}
/**
 * Resolve whether a sender may run slash/control commands under legacy
 * DM/group policy. Ported verbatim from the helper that shipped in
 * `openclaw/plugin-sdk/command-auth` (removed in OpenClaw 2026.10.1).
 *
 * Returns the effective allowlists so callers can report the exact source
 * set used for authorization.
 */
async function resolveSenderCommandAuthorization(params) {
    const shouldComputeAuth = params.shouldComputeCommandAuthorized(params.rawBody, params.cfg);
    const storeAllowFrom = !params.isGroup && params.dmPolicy !== 'allowlist' && params.dmPolicy !== 'open'
        ? await params.readAllowFromStore().catch(() => [])
        : [];
    const channel = params.channel;
    const accountId = params.accountId ?? 'default';
    let configuredAllowFrom = params.configuredAllowFrom;
    let configuredGroupAllowFrom = params.configuredGroupAllowFrom ?? [];
    let dmStoreAllowFrom = storeAllowFrom;
    if (channel) {
        const expand = (allowFrom) => access_groups_1.expandAllowFromWithAccessGroups({
            cfg: params.cfg,
            allowFrom,
            channel,
            accountId,
            senderId: params.senderId,
            isSenderAllowed: params.isSenderAllowed,
            resolveMembership: params.resolveAccessGroupMembership,
        });
        [configuredAllowFrom, configuredGroupAllowFrom] = await Promise.all([
            expand(params.configuredAllowFrom),
            expand(params.configuredGroupAllowFrom ?? []),
        ]);
        if (!params.isGroup)
            dmStoreAllowFrom = await expand(storeAllowFrom);
    }
    const access = channel_policy_1.resolveDmGroupAccessWithLists({
        isGroup: params.isGroup,
        dmPolicy: params.dmPolicy,
        groupPolicy: 'allowlist',
        allowFrom: configuredAllowFrom,
        groupAllowFrom: configuredGroupAllowFrom,
        storeAllowFrom: dmStoreAllowFrom,
        isSenderAllowed: (allowFrom) => params.isSenderAllowed(params.senderId, allowFrom),
    });
    const effectiveAllowFrom = access.effectiveAllowFrom;
    const effectiveGroupAllowFrom = access.effectiveGroupAllowFrom;
    const senderAllowedForCommands = params.isSenderAllowed(params.senderId, params.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom);
    const ownerAllowedForCommands = params.isSenderAllowed(params.senderId, effectiveAllowFrom);
    const groupAllowedForCommands = params.isSenderAllowed(params.senderId, effectiveGroupAllowFrom);
    return {
        shouldComputeAuth,
        effectiveAllowFrom,
        effectiveGroupAllowFrom,
        senderAllowedForCommands,
        commandAuthorized: shouldComputeAuth
            ? params.resolveCommandAuthorizedFromAuthorizers?.({
                useAccessGroups: true,
                authorizers: [
                    { configured: effectiveAllowFrom.length > 0, allowed: ownerAllowedForCommands },
                    { configured: effectiveGroupAllowFrom.length > 0, allowed: groupAllowedForCommands },
                ],
            }) ?? senderAllowedForCommands
            : undefined,
    };
}
