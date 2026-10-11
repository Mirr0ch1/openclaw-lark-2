"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw >= 2026.10 compatibility shim for command authorization.
 *
 * Why this exists:
 *   OpenClaw 2026.10 removed the `openclaw/plugin-sdk/command-auth` subpath and the
 *   `resolveSenderCommandAuthorization()` function entirely (ERR_PACKAGE_PATH_NOT_EXPORTED).
 *   Upstream marks it @deprecated in favour of `resolveChannelMessageIngress()`, which
 *   restructures ingress admission (identity/subject/conversation/route descriptors) and
 *   cannot be substituted 1:1 into this call site.
 *
 * What this does instead:
 *   Rebuild the removed helper from primitives the host STILL exports, mirroring the host's
 *   own DM-branch composition in dist/channel-inbound-*.mjs, so semantics stay as close to
 *   the retired implementation as the current surface allows.
 *
 *   - expandAllowFromWithAccessGroups  <- plugin-sdk/security-runtime
 *   - resolveDmGroupAccessWithLists    <- plugin-sdk/channel-policy
 *   - readChannelIngressStoreAllowFromForDmPolicy <- plugin-sdk/channel-ingress-runtime
 *
 *   shouldComputeCommandAuthorized / resolveCommandAuthorizedFromAuthorizers are NOT
 *   imported here on purpose: the host injects them per-call via
 *   `core.channel.commands.*`, and we must honour the caller's runtime.
 *
 * Safety: fail-closed. Any error yields commandAuthorized=false so a defect can only ever
 * deny commands, never widen authorization.
 */

const { expandAllowFromWithAccessGroups } = require("openclaw/plugin-sdk/security-runtime");
const { resolveDmGroupAccessWithLists } = require("openclaw/plugin-sdk/channel-policy");
const { readChannelIngressStoreAllowFromForDmPolicy } = require("openclaw/plugin-sdk/channel-ingress-runtime");

const DENY = Object.freeze({
    shouldComputeAuth: false,
    effectiveAllowFrom: [],
    effectiveGroupAllowFrom: [],
    senderAllowedForCommands: false,
    commandAuthorized: false,
});

async function resolveSenderCommandAuthorizationImpl(params) {
    const {
        rawBody,
        cfg,
        isGroup,
        dmPolicy,
        configuredAllowFrom,
        configuredGroupAllowFrom,
        senderId,
        isSenderAllowed,
        readAllowFromStore,
        shouldComputeCommandAuthorized,
        resolveCommandAuthorizedFromAuthorizers,
        channel,
        accountId,
        resolveAccessGroupMembership,
    } = params || {};

    if (typeof shouldComputeCommandAuthorized !== "function") {
        throw new Error("command-auth-compat: shouldComputeCommandAuthorized was not supplied by the host runtime");
    }
    if (typeof isSenderAllowed !== "function") {
        throw new Error("command-auth-compat: isSenderAllowed was not supplied");
    }

    const shouldComputeAuth = shouldComputeCommandAuthorized(rawBody, cfg);
    if (!shouldComputeAuth) {
        return {
            shouldComputeAuth: false,
            effectiveAllowFrom: [],
            effectiveGroupAllowFrom: [],
            senderAllowedForCommands: false,
            commandAuthorized: undefined,
        };
    }

    const effectiveDmPolicy = dmPolicy ?? "pairing";

    // Pairing-store entries only participate for DM + pairing policy (host parity).
    const storeAllowFrom = effectiveDmPolicy === "pairing" && typeof readAllowFromStore === "function"
        ? await readChannelIngressStoreAllowFromForDmPolicy({
            provider: channel,
            accountId,
            dmPolicy: effectiveDmPolicy,
            readStore: readAllowFromStore,
        })
        : [];

    const [allowFrom, effectiveStoreAllowFrom] = await Promise.all(
        [configuredAllowFrom ?? [], storeAllowFrom].map((entries) => expandAllowFromWithAccessGroups({
            cfg,
            allowFrom: entries,
            channel,
            accountId,
            senderId,
            isSenderAllowed,
            resolveMembership: resolveAccessGroupMembership,
        })),
    );

    const access = resolveDmGroupAccessWithLists({
        isGroup: !!isGroup,
        dmPolicy: effectiveDmPolicy,
        groupAllowFrom: configuredGroupAllowFrom,
        allowFrom,
        storeAllowFrom: effectiveStoreAllowFrom,
        groupAllowFromFallbackToAllowFrom: false,
        isSenderAllowed: (allowEntries) => isSenderAllowed(senderId, allowEntries),
    });

    // In a group the sender is gated by the group allowlist; in DM by the direct allowlist.
    const effectiveForSender = isGroup ? access.effectiveGroupAllowFrom : access.effectiveAllowFrom;
    const senderAllowedForCommands = isSenderAllowed(senderId, effectiveForSender);

    const commandAuthorized = resolveCommandAuthorizedFromAuthorizers?.({
        useAccessGroups: true,
        authorizers: [{
            configured: effectiveForSender.length > 0,
            allowed: senderAllowedForCommands,
        }],
    }) ?? senderAllowedForCommands;

    return {
        shouldComputeAuth,
        effectiveAllowFrom: access.effectiveAllowFrom,
        effectiveGroupAllowFrom: access.effectiveGroupAllowFrom,
        senderAllowedForCommands,
        commandAuthorized,
    };
}

/** Public shim — never throws; a failure denies commands. */
async function resolveSenderCommandAuthorization(params) {
    try {
        return await resolveSenderCommandAuthorizationImpl(params);
    } catch (error) {
        try {
            console.error("[feishu][command-auth-compat] denying command (fail-closed):", error && error.message ? error.message : error);
        } catch { /* logging must never escalate */ }
        return DENY;
    }
}

module.exports = { resolveSenderCommandAuthorization };