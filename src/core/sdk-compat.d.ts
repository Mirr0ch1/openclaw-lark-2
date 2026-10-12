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
export { jsonResult } from 'openclaw/plugin-sdk/agent-runtime';
/**
 * Extract reaction parameters from raw action params.
 * Returns emoji, remove flag, and isEmpty indicator.
 */
export declare function readReactionParams(params: Record<string, unknown>, opts?: {
    removeErrorMessage?: string;
}): {
    emoji: string;
    remove: boolean;
    isEmpty: boolean;
};
export declare function resolveSenderCommandAuthorization(params: {
    rawBody: string;
    cfg: unknown;
    isGroup: boolean;
    dmPolicy: string;
    configuredAllowFrom?: Array<string | number> | null;
    configuredGroupAllowFrom?: Array<string | number> | null;
    senderId: string;
    isSenderAllowed: (senderId: string, allowFrom: Array<string | number>) => boolean;
    readAllowFromStore: () => Promise<Array<string | number>>;
    shouldComputeCommandAuthorized: (text: string, cfg: unknown) => boolean;
    resolveCommandAuthorizedFromAuthorizers?: (params: {
        useAccessGroups: boolean;
        authorizers: Array<{
            configured: boolean;
            allowed: boolean;
        }>;
    }) => boolean;
    channel?: string;
    accountId?: string;
    resolveAccessGroupMembership?: unknown;
}): Promise<{
    shouldComputeAuth: boolean;
    effectiveAllowFrom: string[];
    effectiveGroupAllowFrom: string[];
    senderAllowedForCommands: boolean;
    commandAuthorized: boolean | undefined;
}>;
