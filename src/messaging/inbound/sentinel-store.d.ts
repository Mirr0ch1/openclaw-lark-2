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
export interface SentinelEntry {
    /** Literal name as it appeared in the outbound text. */
    name: string;
    /** Why parsing failed. */
    reason: 'not_found' | 'ambiguous';
    /** Candidate open_ids when reason === 'ambiguous'. */
    candidates?: Array<{
        openId: string;
        kind?: 'user' | 'bot';
    }>;
}
export declare class SentinelStore {
    private byThread;
    private maxThreads;
    private ttlMs;
    constructor(maxThreads?: number, ttlMs?: number);
    recordSentinels(threadKey: string, sentinels: SentinelEntry[]): void;
    consumeSentinels(threadKey: string): SentinelEntry[];
    clear(): void;
    private evict;
}
export declare function getSentinelStore(accountId: string, maxThreads?: number, ttlMs?: number): SentinelStore;
