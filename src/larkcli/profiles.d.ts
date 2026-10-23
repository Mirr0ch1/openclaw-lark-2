/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Account -> lark-cli profile plumbing.
 *
 * The channel owns the one fact lark-cli cannot know (which Feishu app the
 * current conversation belongs to); lark-cli owns the capability. This module
 * is the seam between them.
 */
export declare const WRAPPER_RELATIVE_PATH: string;
/** Absolute path to bin/feishu-lark shipped with this plugin. */
export declare function wrapperPath(): string;
/** Normalise an accountId into a lark-cli profile name (identity mapping). */
export declare function profileNameFor(accountId?: string | null): string;
/**
 * Whether CLI delegation is active for this account.
 *
 * 'auto' (default) follows binary discovery so hosts without lark-cli never pay
 * for the injected per-turn rules.
 */
export declare function isLarkCliEnabled(cfg: unknown, accountId?: string | null): boolean;
/** Config override first, then PATH, then common install prefixes. */
export declare function resolveLarkCliBinary(cfg: unknown, accountId?: string | null): string | null;
export interface LarkCliProfile {
    name: string;
    appId: string;
    active: boolean;
}
export interface ListProfilesResult {
    ok: boolean;
    profiles: LarkCliProfile[];
    error?: string;
}
/** Parse the JSON emitted by 'lark-cli profile list'. */
export declare function listProfiles(cfg: unknown): ListProfilesResult;
export interface ProvisionResult {
    ok: boolean;
    created: string[];
    updated: string[];
    skipped: string[];
    failed: Array<{
        accountId: string;
        error: string;
    }>;
    /** Path of the lark-cli config backup taken before the first mutation. */
    backup?: string;
}
/**
 * Create/repair one lark-cli profile per configured account. Idempotent;
 * an appId mismatch is only rewritten when force is set.
 */
export declare function provisionProfiles(cfg: unknown, opts?: {
    force?: boolean;
}): ProvisionResult;
export interface HealthRow {
    accountId: string;
    profile: string;
    ok: boolean;
    profileExists?: boolean;
    appIdMatch?: boolean;
    identity?: string;
    tokenStatus?: string;
    error?: string;
}
/** Per-account readiness report (profile exists, appId matches, whoami ready). */
export declare function healthCheck(cfg: unknown): HealthRow[];
/**
 * Per-turn rules telling the agent which profile this turn must use.
 * Pure (no spawning); returns [] when CLI delegation is off or unavailable.
 */
export declare function buildIdentityRules(cfg: unknown, accountId?: string | null): string[];
