/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu webhook transport (ported from @openclaw/feishu monitor.transport.ts).
 */
export declare const DEFAULT_FEISHU_WEBHOOK_PATH: string;
/**
 * Canonicalise a configured webhook path. When unset, the default is
 * account-scoped for named accounts (`<base>/<accountId>`).
 */
export declare function normalizeFeishuWebhookPath(raw?: unknown, accountId?: string): string;
/** True when the signed timestamp is within the allowed clock skew. */
export declare function isFeishuWebhookTimestampFresh(timestamp: unknown, nowMs?: number, maxSkewMs?: number): boolean;
/** sha256(timestamp + nonce + encryptKey + rawBody) as lowercase hex. */
export declare function computeFeishuWebhookSignature(params: {
    timestamp: unknown;
    nonce: unknown;
    encryptKey: string;
    rawBody: string;
}): string;
/** Verify the `x-lark-*` delivery signature against the raw request body. */
export declare function isFeishuWebhookSignatureValid(params: {
    headers: Record<string, unknown>;
    rawBody: string;
    encryptKey: string;
    nowMs?: number;
}): boolean;
/** Build the EventDispatcher envelope (payload + trusted `headers` prototype). */
export declare function buildFeishuWebhookEnvelope(req: {
    headers?: unknown;
}, payload: Record<string, unknown>): Record<string, unknown>;
/** Create the Gateway HTTP route handler for one account. */
export declare function createFeishuWebhookHandler(params: {
    encryptKey: string;
    dispatcher: {
        invoke: (envelope: Record<string, unknown>, options: {
            needCheck: boolean;
        }) => Promise<unknown>;
    };
    /** Overrides the dispatch step (e.g. durable ingress admission). */
    invokeEnvelope?: (envelope: Record<string, unknown>) => Promise<unknown>;
    /** Per-key concurrency limiter applied before the body is read. */
    inFlightLimiter?: unknown;
    inFlightKey?: string;
    now?: () => number;
}): (req: any, res: any) => Promise<void>;
/** Register the webhook route and keep the account alive until aborted. */
export declare function monitorFeishuWebhook(params: {
    account: {
        encryptKey?: string;
        verificationToken?: string;
        config?: {
            webhookPath?: string;
        };
    };
    accountId: string;
    runtime?: unknown;
    abortSignal?: AbortSignal;
    handlers: Record<string, unknown>;
    log?: (...args: unknown[]) => void;
}): Promise<void>;
