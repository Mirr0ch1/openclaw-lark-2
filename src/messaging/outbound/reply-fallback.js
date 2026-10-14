"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-target fallback for outbound Feishu sends.
 *
 * Ported from @openclaw/feishu `src/send.ts` (`sendReplyOrFallbackDirect`).
 *
 * A reply to a message that was withdrawn or deleted fails with a terminal
 * Feishu code (230011 / 231003). Instead of dropping the answer, the send is
 * retried as a top-level create in the same chat, so the user still receives
 * it. This is only safe for *plain* quoted replies: a threaded reply
 * (`reply_in_thread=true`) that fell back to a top-level create would silently
 * pull the answer out of its thread, so a thread reply surfaces the error
 * instead (matching the official `allowTopLevelReplyFallback` default).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWithdrawnReplyError = isWithdrawnReplyError;
exports.withReplyFallback = withReplyFallback;
const api_error_1 = require("../../core/api-error.js");
const auth_errors_1 = require("../../core/auth-errors.js");
/**
 * Whether a thrown send error means the reply target is withdrawn/deleted.
 *
 * Handles the shapes our callers can throw:
 * - `MessageUnavailableError` from `runWithMessageUnavailableGuard` (only ever
 *   thrown for terminal codes, so it is unconditionally a withdrawn target),
 * - a Lark SDK / Axios error carrying `code` / `data.code` / `response.data.code`,
 * - a wrapped error whose `cause` holds the original.
 */
function isWithdrawnReplyError(error) {
    if (!error || typeof error !== 'object')
        return false;
    if (error.name === 'MessageUnavailableError')
        return true;
    const code = (0, api_error_1.extractLarkApiCode)(error);
    if (typeof code === 'number' && auth_errors_1.MESSAGE_TERMINAL_CODES.has(code))
        return true;
    const cause = error.cause;
    if (cause && cause !== error)
        return isWithdrawnReplyError(cause);
    return false;
}
/**
 * Run a reply attempt; on a withdrawn/deleted target, fall back to a top-level
 * create (unless the reply was threaded, where a top-level send would be
 * misplaced). Non-withdrawn errors are re-thrown unchanged.
 */
async function withReplyFallback(params) {
    try {
        return await params.attemptReply();
    }
    catch (error) {
        if (!isWithdrawnReplyError(error))
            throw error;
        if (params.replyInThread)
            throw error;
        return await params.attemptCreate();
    }
}
