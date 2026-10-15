/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Message deduplication.
 *
 * Feishu WebSocket connections may redeliver messages on reconnect, and the
 * gateway may redeliver across restarts. This module tracks recently-seen
 * message IDs and filters duplicates.
 *
 * Backends:
 * - Persistent (default) — host SDK `openclaw/plugin-sdk/persistent-dedupe`,
 *   SQLite-backed, survives restarts.
 * - Memory-only fallback — process-local, used when the SDK subpath is absent.
 *
 * Claim/commit semantics: `claim` takes ownership without recording, `commit`
 * records a handled key, `release` drops a claim so a retry can proceed.
 * `tryRecord` is claim+commit for handlers that record at admission.
 */
/** Claim result from the underlying guard. */
export interface DedupeClaimResult {
    kind: 'claimed' | 'duplicate' | 'inflight';
    pending?: Promise<boolean>;
}
/** The subset of the host SDK claimable-dedupe guard this module relies on. */
export interface ClaimableDedupeGuard {
    claim: (key: string, options?: {
        namespace?: string;
    }) => Promise<DedupeClaimResult>;
    commit: (key: string, options?: {
        namespace?: string;
    }) => Promise<boolean>;
    release: (key: string, options?: {
        namespace?: string;
        error?: unknown;
    }) => void;
    hasRecent: (key: string, options?: {
        namespace?: string;
    }) => Promise<boolean>;
    forget: (key: string, options?: {
        namespace?: string;
    }) => Promise<boolean>;
    warmup: (namespace?: string, onError?: (error: unknown) => void) => Promise<number>;
    clearMemory: () => void;
    memorySize: () => number;
}
export interface MessageDedupOpts {
    /** Time-to-live for each entry in milliseconds (default: 12 h). */
    ttlMs?: number;
    /** Maximum number of tracked entries (default: 5 000). */
    maxEntries?: number;
    /** Force the in-memory fallback (`false`) regardless of SDK availability. */
    persistent?: boolean;
    /** Pre-built claim/commit guard (tests / dependency injection). */
    guard?: ClaimableDedupeGuard;
    /** Disk-error hook for the persistent backend (defaults to a warn log). */
    onDiskError?: (error: unknown) => void;
}
/**
 * Check whether a message is too old to process.
 *
 * Feishu message `create_time` is a millisecond Unix timestamp encoded
 * as a string.  When a WebSocket reconnects after a long outage, stale
 * messages may be redelivered — this function lets callers discard them
 * before entering the full handling pipeline.
 */
export declare function isMessageExpired(createTimeStr: string | undefined, expiryMs?: number): boolean;
export declare class MessageDedup {
    private readonly ttlMs;
    private readonly maxEntries;
    private readonly guard;
    private readonly onDiskError;
    /** Whether the guard is backed by persistent (SQLite) storage. */
    readonly persistent: boolean;
    constructor(opts?: MessageDedupOpts);
    /**
     * Take ownership of a key without recording it. `handle.commit()` records
     * it; `handle.release()` drops the claim.
     */
    claim(id: string, scope?: string): Promise<{
        claimed: boolean;
        handle?: {
            commit: () => Promise<boolean>;
            release: (options?: {
                error?: unknown;
            }) => void;
        };
    }>;
    /** Record a claimed key as handled. */
    commit(id: string, scope?: string): Promise<boolean>;
    /** Drop a claimed key without recording it, so a retry can proceed. */
    release(id: string, scope?: string, options?: {
        error?: unknown;
    }): void;
    /**
     * Claim and immediately commit a key. Returns `true` if the message is new,
     * `false` if it is a duplicate.
     */
    tryRecord(id: string, scope?: string): Promise<boolean>;
    /** Whether a key was recently recorded (without claiming or recording). */
    hasRecent(id: string, scope?: string): Promise<boolean>;
    /** Forget a recorded key so it can be processed again. */
    forget(id: string, scope?: string): Promise<boolean>;
    /** Current number of tracked entries (for diagnostics). */
    get size(): number;
    /**
     * Load persisted entries for a namespace into memory. Call once at account
     * start. Returns the number of entries loaded; 0 in memory-only mode.
     */
    warmup(namespace?: string): Promise<number>;
    /** Remove all in-memory entries (persisted state is left intact). */
    clear(): void;
    /** Clear in-memory state. Alias of {@link clear}. */
    dispose(): void;
}
