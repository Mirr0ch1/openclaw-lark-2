/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Channel type definitions for the Lark/Feishu channel plugin.
 */
import type { ClawdbotConfig, RuntimeEnv } from 'openclaw/plugin-sdk';
import type { HistoryEntry } from 'openclaw/plugin-sdk/reply-history';
import type { LarkClient } from '../core/lark-client';
import type { MessageDedup } from '../messaging/inbound/dedup';
import type { ChannelIngressLifecycle } from './ingress-lifecycle';
import type { FeishuMessageDebounceEntry } from '../messaging/inbound/debounce';
export type { FeishuProbeResult } from '../core/types';
export interface MonitorFeishuOpts {
    config?: ClawdbotConfig;
    runtime?: RuntimeEnv;
    abortSignal?: AbortSignal;
    accountId?: string;
}
export interface FeishuDirectoryPeer {
    kind: 'user';
    id: string;
    name?: string;
}
export interface FeishuDirectoryGroup {
    kind: 'group';
    id: string;
    name?: string;
}
/** Host inbound debouncer (subset used by the message handler). */
export interface InboundDebouncer {
    enqueue: (item: FeishuMessageDebounceEntry) => Promise<void>;
    shouldBuffer: (item: FeishuMessageDebounceEntry) => boolean;
    flushKey: (key: string) => Promise<void>;
    cancelKey: (key: string) => boolean;
    drain: () => Promise<void>;
}
export interface MonitorContext {
    cfg: ClawdbotConfig;
    lark: LarkClient;
    accountId: string;
    chatHistories: Map<string, HistoryEntry[]>;
    messageDedup: MessageDedup;
    /** Per-account inbound debouncer; present only when debounceMs > 0. */
    inboundDebouncer?: InboundDebouncer;
    /**
     * Resolve the durable-ingress turn lifecycle for a parsed event (keyed by
     * `event_id`). Present only when durable ingress is enabled.
     */
    resolveIngressLifecycle?: (data: unknown) => ChannelIngressLifecycle | undefined;
    runtime?: RuntimeEnv;
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
