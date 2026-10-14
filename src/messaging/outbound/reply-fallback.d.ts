/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-target fallback for outbound Feishu sends.
 */

/** A Feishu SDK send response (only the fields the senders read). */
export interface FeishuSendResponse {
    code?: number;
    msg?: string;
    data?: {
        message_id?: string;
        chat_id?: string;
    };
}

/**
 * Whether a thrown send error means the reply target is withdrawn/deleted
 * (Feishu 230011 / 231003) and can be safely retried as a top-level send.
 */
export declare function isWithdrawnReplyError(error: unknown): boolean;

/**
 * Run `attemptReply`; on a withdrawn/deleted target, fall back to
 * `attemptCreate` unless `replyInThread` is true (a threaded reply cannot
 * safely become a top-level message). Non-withdrawn errors re-throw unchanged.
 */
export declare function withReplyFallback(params: {
    attemptReply: () => Promise<FeishuSendResponse | undefined>;
    attemptCreate: () => Promise<FeishuSendResponse | undefined>;
    replyInThread?: boolean;
}): Promise<FeishuSendResponse | undefined>;
