"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Per-thread store for unresolved mention feedback. The outbound
 * normalizer records a SentinelEntry whenever an `@Name` cannot be
 * resolved; the next inbound message on the same thread consumes
 * (take and delete) the entries, which buildMentionAnnotation surfaces
 * as a system note so the next reply can disambiguate.
 *
 * Kept separate from UserNameCache because the lifecycle differs:
 * 10-minute TTL, per-thread keying, and take-and-delete consumption.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SentinelStore = void 0;
exports.getSentinelStore = getSentinelStore;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — short, avoid stale feedback
const DEFAULT_MAX_THREADS = 200; // per-account
function dedup(entries) {
    const seen = new Set();
    const out = [];
    for (const e of entries) {
        const key = `${e.reason}:${e.name}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}
class SentinelStore {
    byThread = new Map();
    maxThreads;
    ttlMs;
    constructor(maxThreads = DEFAULT_MAX_THREADS, ttlMs = DEFAULT_TTL_MS) {
        this.maxThreads = maxThreads;
        this.ttlMs = ttlMs;
    }
    recordSentinels(threadKey, sentinels) {
        if (sentinels.length === 0)
            return;
        const existing = this.byThread.get(threadKey);
        const merged = existing ? [...existing.entries, ...sentinels] : sentinels;
        this.byThread.delete(threadKey); // bump LRU
        this.byThread.set(threadKey, {
            entries: dedup(merged),
            expireAt: Date.now() + this.ttlMs,
        });
        this.evict();
    }
    consumeSentinels(threadKey) {
        const stored = this.byThread.get(threadKey);
        if (!stored)
            return [];
        this.byThread.delete(threadKey);
        if (stored.expireAt <= Date.now())
            return [];
        return stored.entries;
    }
    clear() {
        this.byThread.clear();
    }
    evict() {
        while (this.byThread.size > this.maxThreads) {
            const oldest = this.byThread.keys().next().value;
            if (oldest === undefined)
                break;
            this.byThread.delete(oldest);
        }
    }
}
exports.SentinelStore = SentinelStore;
const registry = new Map();
function getSentinelStore(accountId, maxThreads, ttlMs) {
    let store = registry.get(accountId);
    if (!store) {
        store = new SentinelStore(maxThreads, ttlMs);
        registry.set(accountId, store);
    }
    return store;
}
