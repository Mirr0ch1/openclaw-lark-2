"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Message deduplication.
 *
 * Feishu WebSocket connections may redeliver messages on reconnect, and the
 * gateway can redeliver across restarts. This module tracks recently-seen
 * message IDs and filters duplicates.
 *
 * Two backends:
 * - **Persistent (default)** — delegates to the host SDK's
 *   `openclaw/plugin-sdk/persistent-dedupe` guard (SQLite-backed plugin
 *   state). Survives gateway restarts: entries are warmed into memory at
 *   account start and re-checked from disk on a memory miss.
 * - **Memory-only fallback** — a process-local store, used when the SDK
 *   subpath is unavailable on an older core. Entries are lost on restart.
 *
 * Claim/commit semantics (ported from @openclaw/feishu `dedup.ts`):
 *   - `claim(id)`   — take ownership of a key WITHOUT recording it. Returns
 *                     `{ claimed: false }` for an already-seen or in-flight key.
 *   - `commit(id)`  — record the key as handled (call after the work is safely
 *                     adopted, e.g. the message is enqueued).
 *   - `release(id)` — drop the claim without recording, so a retry can proceed.
 * `tryRecord(id)` is the claim+commit convenience for handlers that record at
 * admission.
 *
 * Claim/commit matters because the durable ingress tombstones an `event_id`
 * only after a handler returns; recording a logical key at admission would let
 * a crash mid-handler permanently suppress the redelivery. Committing after the
 * work is adopted keeps the at-least-once guarantee.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageDedup = void 0;
exports.isMessageExpired = isMessageExpired;
const lark_logger_1 = require("../../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('inbound/dedup');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — matches @openclaw/feishu dedup-state.ts
const DEFAULT_MAX_ENTRIES = 5_000;
// ---------------------------------------------------------------------------
// Message expiry check
// ---------------------------------------------------------------------------
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
/**
 * Check whether a message is too old to process.
 *
 * Feishu message `create_time` is a millisecond Unix timestamp encoded
 * as a string.  When a WebSocket reconnects after a long outage, stale
 * messages may be redelivered — this function lets callers discard them
 * before entering the full handling pipeline.
 */
function isMessageExpired(createTimeStr, expiryMs = DEFAULT_EXPIRY_MS) {
    if (!createTimeStr)
        return false;
    const createTime = parseInt(createTimeStr, 10);
    if (Number.isNaN(createTime))
        return false;
    return Date.now() - createTime > expiryMs;
}
// ---------------------------------------------------------------------------
// Persistent backend loading (feature-detected)
// ---------------------------------------------------------------------------
// Mirrors @openclaw/feishu `dedup-state.ts`: the guard is namespaced under the
// plugin id and a `feishu.dedup` prefix so multiple accounts share one SQLite
// namespace family without colliding.
const DEDUPE_PLUGIN_ID = 'openclaw-lark-2';
const DEDUPE_NAMESPACE_PREFIX = 'feishu.dedup';
/**
 * Resolve the host SDK's `createClaimableDedupe` factory.
 *
 * Returns `null` when the SDK subpath is missing (older cores) or fails to
 * load, in which case `MessageDedup` uses the in-memory fallback guard.
 */
function loadClaimableDedupeFactory() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('openclaw/plugin-sdk/persistent-dedupe');
        return typeof mod?.createClaimableDedupe === 'function' ? mod.createClaimableDedupe : null;
    }
    catch {
        return null;
    }
}
const createClaimableDedupe = loadClaimableDedupeFactory();
const nsKey = (namespace, key) => `${namespace || 'global'}\u0000${key}`;
/**
 * Process-local claim/commit guard used when the host SDK is unavailable.
 * Mirrors the subset of `createClaimableDedupe` this module relies on, with
 * FIFO capacity eviction.
 */
function createMemoryGuard(ttlMs, maxEntries) {
    const seen = new Map();
    const inflight = new Set();
    const isRecent = (key) => {
        const ts = seen.get(key);
        return ts !== undefined && Date.now() - ts < ttlMs;
    };
    return {
        async claim(key, opts = {}) {
            const k = nsKey(opts.namespace, key);
            if (inflight.has(k))
                return { kind: 'inflight', pending: Promise.resolve(false) };
            if (isRecent(k))
                return { kind: 'duplicate' };
            inflight.add(k);
            return { kind: 'claimed' };
        },
        async commit(key, opts = {}) {
            const k = nsKey(opts.namespace, key);
            inflight.delete(k);
            if (seen.size >= maxEntries) {
                const oldest = seen.keys().next().value;
                if (oldest !== undefined)
                    seen.delete(oldest);
            }
            seen.set(k, Date.now());
            return true;
        },
        release(key, opts = {}) {
            inflight.delete(nsKey(opts.namespace, key));
        },
        async hasRecent(key, opts = {}) {
            return isRecent(nsKey(opts.namespace, key));
        },
        async forget(key, opts = {}) {
            const k = nsKey(opts.namespace, key);
            inflight.delete(k);
            return seen.delete(k);
        },
        async warmup() {
            return 0;
        },
        clearMemory() {
            seen.clear();
            inflight.clear();
        },
        memorySize() {
            return seen.size;
        },
    };
}
// ---------------------------------------------------------------------------
// Message deduplication
// ---------------------------------------------------------------------------
class MessageDedup {
    ttlMs;
    maxEntries;
    /** Claim/commit guard (persistent or memory-only). */
    guard;
    onDiskError;
    /** Whether the guard is backed by persistent (SQLite) storage. */
    persistent;
    constructor(opts = {}) {
        this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.onDiskError =
            opts.onDiskError ??
                ((error) => log.warn('persistent dedupe disk error', { error: String(error) }));
        const wantsPersistent = opts.persistent !== false;
        if (opts.guard) {
            this.guard = opts.guard;
            this.persistent = wantsPersistent;
        }
        else if (!wantsPersistent || !createClaimableDedupe) {
            this.guard = createMemoryGuard(this.ttlMs, this.maxEntries);
            this.persistent = false;
        }
        else {
            this.guard = createClaimableDedupe({
                pluginId: DEDUPE_PLUGIN_ID,
                namespacePrefix: DEDUPE_NAMESPACE_PREFIX,
                ttlMs: this.ttlMs,
                memoryMaxSize: this.maxEntries,
                stateMaxEntries: this.maxEntries,
                onDiskError: this.onDiskError,
            });
            this.persistent = true;
        }
    }
    /**
     * Take ownership of a key without recording it.
     *
     * @returns `{ claimed: true, handle }` when this caller owns the key, where
     *          `handle.commit()` records it and `handle.release()` drops the
     *          claim; `{ claimed: false }` when it was already handled
     *          (duplicate) or is owned elsewhere (in-flight).
     */
    async claim(id, scope) {
        const result = await this.guard.claim(id, { namespace: scope || 'global' });
        if (result.kind !== 'claimed') {
            return { claimed: false };
        }
        return {
            claimed: true,
            handle: {
                commit: () => this.commit(id, scope),
                release: (options) => this.release(id, scope, options),
            },
        };
    }
    /** Record a claimed key as handled. */
    async commit(id, scope) {
        return this.guard.commit(id, { namespace: scope || 'global' });
    }
    /** Drop a claimed key without recording it, so a retry can proceed. */
    release(id, scope, options) {
        this.guard.release(id, { namespace: scope || 'global', ...(options ?? {}) });
    }
    /**
     * Claim and immediately commit a key.
     *
     * Convenience for handlers that record at admission (no separate commit
     * point). Returns `true` if the message is new, `false` if a duplicate.
     */
    async tryRecord(id, scope) {
        const claim = await this.claim(id, scope);
        if (!claim.claimed)
            return false;
        await this.commit(id, scope);
        return true;
    }
    /** Whether a key was recently recorded (without claiming or recording). */
    async hasRecent(id, scope) {
        return this.guard.hasRecent(id, { namespace: scope || 'global' });
    }
    /** Forget a recorded key so it can be processed again. */
    async forget(id, scope) {
        return this.guard.forget(id, { namespace: scope || 'global' });
    }
    /** Current number of tracked entries (for diagnostics). */
    get size() {
        return this.guard.memorySize();
    }
    /**
     * Load persisted entries for a namespace into memory. Call once at account
     * start, before the transport begins accepting messages, so a redelivery
     * that races startup is still caught. No-op (returns 0) in memory-only mode.
     */
    async warmup(namespace) {
        return this.guard.warmup(namespace, this.onDiskError);
    }
    /** Remove all in-memory entries (persisted state is left intact). */
    clear() {
        this.guard.clearMemory();
    }
    /** Clear in-memory state. Alias of {@link clear}. */
    dispose() {
        this.clear();
    }
}
exports.MessageDedup = MessageDedup;
