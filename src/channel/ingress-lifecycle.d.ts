/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Fan-in lifecycle for a debounced inbound flush.
 *
 * Ported from @openclaw/feishu `src/feishu-ingress.ts`
 * `buildFeishuFlushIngressLifecycle`. Fans several buffered messages' durable
 * ingress lifecycles into one turn lifecycle, committing logical replay
 * (dedupe) claims only after adoption.
 */
/** Logical replay (dedupe) claim handle produced by the dedupe guard. */
export interface ChannelReplayClaimHandle {
    readonly keys?: readonly [string, ...string[]];
    commit: (options?: unknown) => Promise<boolean>;
    release: (options?: {
        error?: unknown;
    }) => void;
}
/** Durable-ingress ownership lifecycle for one inbound turn. */
export interface ChannelIngressLifecycle {
    abortSignal: AbortSignal;
    onAdopted: () => Promise<void>;
    onDeferred: () => boolean | void;
    onDeferredHeartbeat?: () => void;
    deferredHeartbeatIntervalMs?: number;
    onAdoptionFinalizing: () => void;
    onFailed?: (error: unknown) => Promise<void>;
    onAbandoned: () => Promise<void>;
    registerAbandonHandler?: (handler: () => void | Promise<void>) => () => void;
}
/** Per-message source pair fed to {@link buildFlushIngressLifecycle}. */
export interface FlushLifecycleSource {
    lifecycle?: ChannelIngressLifecycle;
    replayClaim?: ChannelReplayClaimHandle;
}
/** Turn lifecycle produced by the fan-in, plus a no-turn settle helper. */
export interface FlushIngressLifecycle {
    lifecycle: ChannelIngressLifecycle | undefined;
    settle: () => Promise<void>;
}
/**
 * Build the flush lifecycle for a set of source entries.
 *
 * @returns `{ lifecycle, settle }`. `lifecycle` is `undefined` when no source
 *   carries a durable lifecycle (i.e. durable ingress is off).
 */
export declare function buildFlushIngressLifecycle(sources: readonly FlushLifecycleSource[], options?: {
    onReplayCommitError?: (error: unknown) => void;
}): FlushIngressLifecycle;
