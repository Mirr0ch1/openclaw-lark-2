"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Rate-limit classification and retry for outbound Feishu sends.
 *
 * Ported from @openclaw/feishu (`src/send-rate-limit.ts` +
 * `src/comment-shared.ts#requestFeishuApi`).
 *
 * Feishu signals throttling in two ways:
 *   1. An SDK throw carrying `response.status === 429` or a business code
 *      (`230020`, `11232`) in `response.data`.
 *   2. A *fulfilled* response whose body carries a rate-limit code — the
 *      request never sent, but the SDK does not reject it. Both must be
 *      treated as retryable so a throttled turn is not silently dropped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEISHU_SEND_MAX_RETRIES = void 0;
exports.getFeishuSendRateLimitCode = getFeishuSendRateLimitCode;
exports.getFeishuSendRateLimitCodeFromResponse = getFeishuSendRateLimitCodeFromResponse;
exports.feishuSendRequest = feishuSendRequest;
const lark_logger_1 = require("../../core/lark-logger.js");
const send_context_1 = require("./send-context.js");
const log = (0, lark_logger_1.larkLogger)('outbound/send-rate-limit');
/** Business codes that mean "throttled, safe to retry". */
const FEISHU_SEND_RATE_LIMIT_CODES = new Set([230020, 11232]);
/** Retry budget (in addition to the first attempt). */
const FEISHU_SEND_MAX_RETRIES = 2;
exports.FEISHU_SEND_MAX_RETRIES = FEISHU_SEND_MAX_RETRIES;
const FEISHU_SEND_RETRY_BASE_MS = 500;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Classify a fulfilled Feishu response body (`{ code, ... }`). */
function getFeishuSendRateLimitCodeFromResponse(response) {
    if (!response || typeof response !== 'object')
        return undefined;
    const code = response.code;
    return typeof code === 'number' && FEISHU_SEND_RATE_LIMIT_CODES.has(code) ? code : undefined;
}
/** Classify a thrown error (Axios-shaped `error.response` or a raw body). */
function getFeishuSendRateLimitCode(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const response = error.response && typeof error.response === 'object' ? error.response : undefined;
    if (response?.status === 429)
        return 429;
    return getFeishuSendRateLimitCodeFromResponse(response?.data);
}
/**
 * Run a Feishu send request with rate-limit-aware retry.
 *
 * On exhaustion the *original* error is rethrown unchanged (for throws) so
 * upstream error handling — e.g. message-unavailable detection — still sees
 * the real shape. A fulfilled rate-limit body is converted into a throw,
 * because the message was never delivered and pretending otherwise would
 * leave callers with an empty `messageId`.
 */
async function feishuSendRequest(request, label) {
    // Re-check send authority immediately before each physical attempt: the
    // host may have retired this turn while a previous attempt was in flight.
    const scope = (0, send_context_1.captureFeishuSendContext)();
    for (let attempt = 0;; attempt++) {
        scope?.assertCurrent();
        // Refresh durable dispatch timing immediately before provider I/O.
        await scope?.onPlatformSendDispatch?.();
        let result;
        try {
            result = await request();
        }
        catch (err) {
            const code = getFeishuSendRateLimitCode(err);
            if (code === undefined || attempt >= FEISHU_SEND_MAX_RETRIES)
                throw err;
            const delay = FEISHU_SEND_RETRY_BASE_MS * 2 ** attempt;
            log.warn(`${label}: rate-limited (code=${code}), retry ${attempt + 1}/${FEISHU_SEND_MAX_RETRIES} after ${delay}ms`);
            await sleep(delay);
            continue;
        }
        const code = getFeishuSendRateLimitCodeFromResponse(result);
        if (code === undefined)
            return result;
        if (attempt >= FEISHU_SEND_MAX_RETRIES) {
            throw Object.assign(new Error(`${label}: rate-limited (code=${code})`), {
                response: { status: 200, data: result },
            });
        }
        const delay = FEISHU_SEND_RETRY_BASE_MS * 2 ** attempt;
        log.warn(`${label}: fulfilled with rate-limit code=${code}, retry ${attempt + 1}/${FEISHU_SEND_MAX_RETRIES} after ${delay}ms`);
        await sleep(delay);
    }
}
