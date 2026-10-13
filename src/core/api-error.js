"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared Lark API error handling utilities.
 *
 * Provides unified error handling for two distinct error paths:
 *
 * 1. **Response-level errors** — The SDK returns a response object with a
 *    non-zero `code`.  Handled by {@link assertLarkOk}.
 *
 * 2. **Thrown exceptions** — The SDK throws an Axios-style error (HTTP 4xx)
 *    whose properties include the Feishu error `code` and `msg`.
 *    Handled by {@link formatLarkError}.
 *
 * Both paths intercept well-known codes (e.g. LARK_ERROR.APP_SCOPE_MISSING (99991672) — missing API scopes)
 * and produce user-friendly messages with actionable authorization links.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLarkApiCode = extractLarkApiCode;
exports.extractFeishuApiErrorMeta = extractFeishuApiErrorMeta;
exports.assertLarkOk = assertLarkOk;
exports.formatLarkError = formatLarkError;
const permission_url_1 = require("./permission-url.js");
const auth_errors_1 = require("./auth-errors.js");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Given a Feishu error code and msg, format a user-friendly permission
 * error string if the code is LARK_ERROR.APP_SCOPE_MISSING (99991672).  Returns `null` for other codes.
 */
function formatPermissionError(code, msg) {
    if (code !== auth_errors_1.LARK_ERROR.APP_SCOPE_MISSING)
        return null;
    const authUrl = (0, permission_url_1.extractPermissionGrantUrl)(msg);
    const scopes = (0, permission_url_1.extractPermissionScopes)(msg);
    return `权限不足：应用缺少 [${scopes}] 权限。\n` + `请管理员点击以下链接申请并开通权限：\n${authUrl}`;
}
// ---------------------------------------------------------------------------
// Code extraction
// ---------------------------------------------------------------------------
function coerceCode(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
/**
 * 从 Lark SDK 抛错对象中提取飞书 API code。
 *
 * 支持三种常见结构：
 * - `{ code }` — SDK 直接挂载
 * - `{ data: { code } }` — 响应体嵌套
 * - `{ response: { data: { code } } }` — Axios 风格
 */
function extractLarkApiCode(err) {
    if (!err || typeof err !== 'object')
        return undefined;
    const e = err;
    return coerceCode(e.code) ?? coerceCode(e.data?.code) ?? coerceCode(e.response?.data?.code);
}
function readErrorMetaString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
/**
 * 提取结构化飞书 API 错误元信息，用于工具错误返回。
 *
 * 对齐官方 @openclaw/feishu 的 `extractFeishuApiErrorMeta`：把 HTTP 状态、
 * 业务 code、msg 与 log_id 暴露出来，让 99991672（缺权限）等失败无需翻
 * 原始日志即可定位。
 */
function extractFeishuApiErrorMeta(error) {
    if (!error || typeof error !== 'object') {
        return { message: typeof error === 'string' ? error : String(error) };
    }
    const e = error;
    const response = e.response && typeof e.response === 'object' ? e.response : undefined;
    const responseData = (response?.data && typeof response.data === 'object')
        ? response.data
        : (e.data && typeof e.data === 'object' ? e.data : undefined);
    const nestedError = responseData?.error && typeof responseData.error === 'object' ? responseData.error : undefined;
    return {
        message: typeof e.message === 'string' ? e.message : String(error),
        code: e.code,
        httpStatus: typeof response?.status === 'number' ? response.status : undefined,
        feishuCode: typeof responseData?.code === 'number' ? responseData.code : readErrorMetaString(responseData?.code),
        feishuMsg: readErrorMetaString(responseData?.msg),
        feishuLogId: readErrorMetaString(responseData?.log_id) ?? readErrorMetaString(nestedError?.log_id),
        troubleshooter: readErrorMetaString(responseData?.troubleshooter) ?? readErrorMetaString(nestedError?.troubleshooter),
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Assert that a Lark SDK response is successful (code === 0).
 *
 * For permission errors (code LARK_ERROR.APP_SCOPE_MISSING (99991672)), the thrown error includes the
 * required scope names and a direct authorization URL so the AI can
 * present it to the end user.
 */
function assertLarkOk(res) {
    if (!res.code || res.code === 0)
        return;
    const permMsg = formatPermissionError(res.code, res.msg ?? '');
    if (permMsg)
        throw new Error(permMsg);
    throw new Error(res.msg ?? `Feishu API error (code: ${res.code})`);
}
/**
 * Extract a meaningful error message from a thrown Lark SDK / Axios error.
 *
 * The Lark SDK throws Axios errors whose object carries Feishu-specific
 * fields (`code`, `msg`) alongside the standard `message`.  For permission
 * errors (LARK_ERROR.APP_SCOPE_MISSING (99991672)) we format a user-friendly string with scopes + auth URL.
 * For all other errors we try `err.msg` first (the Feishu detail) and fall
 * back to `err.message` (the generic Axios text).
 */
function formatLarkError(err) {
    if (!err || typeof err !== 'object') {
        return String(err);
    }
    const e = err;
    // Path 1: Lark SDK merges Feishu fields onto the thrown error object.
    if (typeof e.code === 'number' && e.msg) {
        const permMsg = formatPermissionError(e.code, e.msg);
        if (permMsg)
            return permMsg;
        return e.msg;
    }
    // Path 2: Standard Axios error — dig into response.data.
    const data = e.response?.data;
    if (data && typeof data.code === 'number' && data.msg) {
        const permMsg = formatPermissionError(data.code, data.msg);
        if (permMsg)
            return permMsg;
        return data.msg;
    }
    // Fallback.
    return e.message ?? String(err);
}
