/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Event handlers for the Feishu WebSocket monitor.
 *
 * Extracted from monitor.ts to improve testability and reduce
 * function size. Each handler receives a MonitorContext with all
 * dependencies needed to process the event.
 */
import type { MonitorContext } from './types';
import type { ChannelIngressLifecycle } from './ingress-lifecycle';
import type { FeishuMessageDebounceEntry } from '../messaging/inbound/debounce';
export declare function handleMessageEvent(ctx: MonitorContext, data: unknown): Promise<void | {
    kind: 'deferred';
} | {
    kind: 'failed-retryable';
    error: unknown;
}>;
/**
 * Enqueue a (possibly merged) message into the per-chat serial queue and run
 * the handler. Owns the logical claim settlement and (for debounced flushes)
 * the durable-ingress adoption.
 */
export declare function dispatchFeishuMessage(ctx: MonitorContext, event: Record<string, unknown>, processingClaim: FeishuMessageDebounceEntry['processingClaim'], admissionLifecycle: ChannelIngressLifecycle | undefined): Promise<void>;
export declare function handleReactionEvent(ctx: MonitorContext, data: unknown): Promise<void>;
export declare function handleBotMembershipEvent(ctx: MonitorContext, data: unknown, action: 'added' | 'removed'): Promise<void>;
export declare function handleVcMeetingInvitedEvent(ctx: MonitorContext, data: unknown): Promise<void>;
export declare function handleCommentEvent(ctx: MonitorContext, data: unknown): Promise<void>;
export declare function handleCardActionEvent(ctx: MonitorContext, data: unknown): Promise<unknown>;
