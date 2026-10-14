/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu interactive dispatch wrapper.
 *
 * This module adapts Feishu `card.action.trigger` events into OpenClaw's
 * standard interactive dispatch pipeline:
 * - Plugins register via `api.registerInteractiveHandler({ channel, namespace, handler })`
 * - Channel forwards via `dispatchPluginInteractiveHandler()`
 *
 * We intentionally do NOT maintain any channel-local global registry here.
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
export type FeishuInteractiveHandlerResponse = unknown;
export interface FeishuInteractiveHandlerContext {
    channel: 'feishu';
    accountId: string;
    senderId?: string;
    conversationId?: string;
    messageId?: string;
    namespace: string;
    payload: string;
    action: string;
    rawEvent: unknown;
    respond: {
        reply: (args: {
            text: string;
        }) => Promise<void>;
        followUp: (args: {
            text: string;
        }) => Promise<void>;
        /**
         * Best-effort "edit current message" mapping.
         * In Feishu, we prefer updating the original interactive card when possible.
         */
        editMessage: (args: {
            text?: string;
            blocks?: unknown[];
        }) => Promise<void>;
    };
}
/**
 * Build the core dedupe id for a card callback.
 *
 * Keyed on the callback event id (falling back to the token) so a real
 * re-click on the same button is not collapsed by core's 5-minute TTL dedupe.
 * Returns `undefined` when neither id is present so core skips dedupe.
 */
export declare function resolveInteractiveDedupeId(accountId: string, eventId?: string, token?: string): string | undefined;
/**
 * Dispatch a Feishu interactive card action to business plugins through
 * the OpenClaw SDK's standard interactive dispatch pipeline.
 *
 * Returns `undefined` when:
 * - the event does not look like an interactive action we can route, or
 * - no plugin handler is registered for the derived namespace.
 *
 * @param params.cfg - OpenClaw config snapshot.
 * @param params.accountId - Current Feishu account id.
 * @param params.data - Raw `card.action.trigger` event payload.
 */
export declare function dispatchFeishuPluginInteractiveHandler(params: {
    cfg: ClawdbotConfig;
    accountId: string;
    data: unknown;
}): Promise<unknown | undefined>;
