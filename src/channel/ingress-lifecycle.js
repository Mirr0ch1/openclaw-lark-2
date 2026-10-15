"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Fan-in lifecycle for a debounced inbound flush.
 *
 * Ported from @openclaw/feishu `src/feishu-ingress.ts`
 * `buildFeishuFlushIngressLifecycle`.
 *
 * When several buffered messages are merged into a single dispatched turn,
 * each source message carries its own durable-ingress lifecycle (one queue
 * row each). This module fans those lifecycles into ONE turn lifecycle so the
 * merged dispatch adopts (or abandons) every underlying queue row together,
 * and commits the logical replay (dedupe) claims only after adoption — a
 * partial best-effort guard write may admit a duplicate, but must never split
 * or suppress recovery of an unadopted turn.
 *
 * `settle()` handles the no-turn case (a gated / empty flush): it releases the
 * replay claims and adopts the transport lifecycle so the rows do not linger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlushIngressLifecycle = buildFlushIngressLifecycle;
const channel_ingress_runtime_1 = require("openclaw/plugin-sdk/channel-ingress-runtime");
/**
 * Build the flush lifecycle for a set of source entries.
 *
 * @param sources  Per-message `{ lifecycle?, replayClaim? }` pairs.
 * @param options.onReplayCommitError  Called when committing a replay claim
 *   fails after adoption (reporting cannot undo an adopted durable turn).
 * @returns `{ lifecycle, settle }`. `lifecycle` is `undefined` when no source
 *   carries a durable lifecycle (i.e. durable ingress is off).
 */
function buildFlushIngressLifecycle(sources, options = {}) {
    const durableSources = sources.filter((source) => source.lifecycle !== undefined);
    const lifecycles = durableSources.map((source) => source.lifecycle);
    const replayClaims = durableSources
        .map((source) => source.replayClaim)
        .filter((claim) => claim !== undefined);
    const transportLifecycle = (0, channel_ingress_runtime_1.fanInChannelIngressLifecycles)(lifecycles).lifecycle;
    if (!transportLifecycle) {
        return { lifecycle: undefined, settle: async () => { } };
    }
    let handedOff = false;
    let terminal;
    let adopting;
    let abandoning;
    const releaseReplayClaims = () => {
        for (const claim of replayClaims) {
            claim.release({ error: new Error('feishu-ingress-not-adopted') });
        }
    };
    const runAbandon = async () => {
        if (terminal)
            return;
        releaseReplayClaims();
        await transportLifecycle.onAbandoned();
        terminal = 'abandoned';
    };
    const ensureAbandoned = async () => {
        if (terminal)
            return;
        const activeAbandonment = abandoning ?? runAbandon();
        abandoning = activeAbandonment;
        try {
            await activeAbandonment;
        }
        finally {
            if (abandoning === activeAbandonment && terminal !== 'abandoned') {
                abandoning = undefined;
            }
        }
    };
    const abandonAll = async () => {
        if (terminal)
            return;
        if (adopting) {
            await adopting.catch(() => undefined);
            if (terminal)
                return;
        }
        await ensureAbandoned();
    };
    const adoptAll = async () => {
        if (terminal)
            return;
        if (abandoning) {
            await abandoning.catch(() => undefined);
            if (terminal)
                return;
        }
        const activeAdoption = adopting ??
            (async () => {
                try {
                    await transportLifecycle.onAdopted();
                    terminal = 'adopted';
                    // Queue adoption is authoritative. Logical twin guards commit
                    // only afterward: partial best-effort guard writes may admit a
                    // duplicate, but can never split or suppress recovery of an
                    // unadopted turn.
                    const results = await Promise.allSettled(replayClaims.map(async (claim) => claim.commit()));
                    for (const result of results) {
                        if (result.status === 'rejected') {
                            try {
                                options.onReplayCommitError?.(result.reason);
                            }
                            catch {
                                // Reporting cannot undo an already adopted durable turn.
                            }
                        }
                    }
                }
                catch (error) {
                    await ensureAbandoned().catch(() => undefined);
                    throw error;
                }
            })();
        adopting = activeAdoption;
        try {
            await activeAdoption;
        }
        finally {
            if (adopting === activeAdoption && terminal !== 'adopted') {
                adopting = undefined;
            }
        }
    };
    return {
        lifecycle: {
            abortSignal: transportLifecycle.abortSignal,
            onAdopted: async () => {
                handedOff = true;
                await adoptAll();
            },
            onDeferred: () => {
                handedOff = true;
                transportLifecycle.onDeferred();
            },
            onDeferredHeartbeat: () => transportLifecycle.onDeferredHeartbeat?.(),
            onAdoptionFinalizing: () => {
                transportLifecycle.onAdoptionFinalizing();
            },
            onAbandoned: async () => {
                handedOff = true;
                await abandonAll();
            },
        },
        // A gated/no-turn envelope is terminal for transport replay, but its
        // logical claim releases so a different event_id twin can run the gate.
        settle: async () => {
            if (handedOff) {
                return;
            }
            handedOff = true;
            releaseReplayClaims();
            try {
                transportLifecycle.onAdoptionFinalizing();
                await transportLifecycle.onAdopted();
                terminal = 'adopted';
            }
            catch (error) {
                await ensureAbandoned().catch(() => undefined);
                throw error;
            }
        },
    };
}
