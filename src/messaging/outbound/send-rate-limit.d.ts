/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Rate-limit classification and retry for outbound Feishu sends.
 */
/** Retry budget (in addition to the first attempt). */
export declare const FEISHU_SEND_MAX_RETRIES = 2;
/** Classify a fulfilled Feishu response body (`{ code, ... }`). */
export declare function getFeishuSendRateLimitCodeFromResponse(response: unknown): number | undefined;
/** Classify a thrown error (Axios-shaped `error.response` or a raw body). */
export declare function getFeishuSendRateLimitCode(error: unknown): number | undefined;
/**
 * Assert that a fulfilled Feishu send response is a business success
 * (`code === 0`). Throws an error carrying `code` + a synthetic
 * `response.data` for non-zero business codes.
 */
export declare function assertFeishuSendSuccess(response: unknown, label: string): void;
/**
 * Run a Feishu send request with rate-limit-aware retry.
 */
export declare function feishuSendRequest<T>(request: () => Promise<T>, label: string): Promise<T>;
