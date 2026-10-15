/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Durable inbound admission for Feishu (ported from @openclaw/feishu feishu-ingress.ts).
 */
export declare const FEISHU_INGRESS_PAYLOAD_VERSION = 1;
export interface FeishuIngressFacts {
    eventId: string;
    laneKey: string;
}
/**
 * Extract durable identity + ordering lane from a raw Feishu envelope.
 * `null` means "not durable" — callers should dispatch directly.
 */
export declare function inspectFeishuIngressEnvelope(rawEnvelope: string, options?: {
    allowInvalidLane?: boolean;
    encryptKey?: string;
}): FeishuIngressFacts | null;
export interface FeishuDurableIngress {
    invoke: (data: unknown, params?: unknown) => Promise<unknown>;
    invokeWebhook: (data: unknown, params?: unknown) => Promise<{
        kind: 'durable' | 'non-durable';
        value: unknown;
    }>;
    /**
     * Resolve the turn lifecycle for an in-flight durable delivery from its
     * parsed event `data` (keyed by `data.event_id`). Returns `undefined` when
     * the event is not a durable delivery (e.g. card actions).
     */
    resolveLifecycle: (data: unknown) => import('./ingress-lifecycle').ChannelIngressLifecycle | undefined;
    start: () => void;
    stop: () => Promise<void>;
}
/** Create the durable ingress, or `null` when the host has no ingress queue. */
export declare function createFeishuDurableIngress(params: {
    accountId: string;
    runtime?: {
        state?: {
            openChannelIngressQueue?: (options?: {
                accountId?: string;
            }) => unknown;
        };
    };
    dispatcher: {
        invoke: (envelope: unknown, options: {
            needCheck: boolean;
        }) => Promise<unknown>;
    };
    /** Enables classification of encrypted envelopes. */
    encryptKey?: string;
    log?: (message: string) => void;
}): FeishuDurableIngress | null;
