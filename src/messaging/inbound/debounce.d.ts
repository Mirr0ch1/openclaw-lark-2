/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Inbound debounce merge.
 *
 * Ported from @openclaw/feishu `src/monitor.message-handler.ts`. Buffers rapid
 * text messages per (account, chat, thread, sender) and merges them into one
 * synthetic message after a quiet period. Opt-in via core config
 * `messages.inbound.debounceMs` (default 0 = off).
 */
/** One buffered message plus its dedupe/replay ownership. */
export interface FeishuMessageDebounceEntry {
    event: Record<string, unknown>;
    processingClaim?: {
        commit: () => Promise<boolean>;
        release: (options?: {
            error?: unknown;
        }) => void;
    };
    turnAdoptionLifecycle?: import('../../channel/ingress-lifecycle').ChannelIngressLifecycle;
    abandoned?: boolean;
}
/**
 * Extract the human-readable text of a text message, substituting mention
 * placeholders with `@Name`. The bot's own mention is removed. Returns `''`
 * for non-text or unparseable messages.
 */
export declare function extractDebounceText(event: unknown, botOpenId?: string): string;
/** Union of mentions across events, de-duplicated by stable id (or name|key). */
export declare function mergeFeishuDebounceMentions(events: readonly unknown[]): unknown[] | undefined;
/**
 * Whether the message is a "mention forward" request: in a group, the bot plus
 * at least one other user are mentioned; in a DM, any user is mentioned.
 */
export declare function isMentionForwardRequest(event: unknown, botOpenId?: string): boolean;
/** Resolve the merged `mentions` array for a debounced flush. */
export declare function resolveFeishuDebounceMentions(params: {
    entries: readonly unknown[];
    botOpenId?: string;
}): unknown[] | undefined;
/** Drop entries whose logical dedupe key repeats, keeping the first. */
export declare function dedupeFeishuDebounceEntriesByDedupeKey<T extends {
    event: unknown;
}>(entries: readonly T[]): T[];
/** Parameters for {@link createFeishuInboundDebouncer}. */
export interface CreateFeishuInboundDebouncerParams {
    accountId: string;
    debounceMs: number;
    dispatch: (event: Record<string, unknown>, dedupeKey: string | undefined, processingClaim: FeishuMessageDebounceEntry['processingClaim'], admissionLifecycle: {
        abortSignal: AbortSignal;
        onAdopted: () => Promise<void>;
        onAbandoned: () => Promise<void>;
    }) => Promise<void>;
    getBotOpenId?: () => string | undefined;
    hasProcessed: (dedupeKey: string | undefined, namespace: string, log?: (...args: unknown[]) => void) => Promise<boolean>;
    resolveDebounceText?: (event: unknown) => string;
    isControlCommand?: (text: string) => boolean;
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
/**
 * Create the per-account inbound debouncer. Returns the host SDK debouncer
 * (`{ enqueue, shouldBuffer, flushKey, cancelKey, drain }`).
 */
export declare function createFeishuInboundDebouncer(params: CreateFeishuInboundDebouncerParams): {
    enqueue: (item: FeishuMessageDebounceEntry) => Promise<void>;
    shouldBuffer: (item: FeishuMessageDebounceEntry) => boolean;
    flushKey: (key: string) => Promise<void>;
    cancelKey: (key: string) => boolean;
    drain: () => Promise<void>;
};
