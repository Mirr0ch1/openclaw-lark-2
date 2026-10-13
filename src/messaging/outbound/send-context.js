"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Outbound send authority scope.
 *
 * Ported from @openclaw/feishu `src/send-context.ts`.
 *
 * The host may retire a turn (abort / prepare a new one) while a send is still
 * in flight, and it hands the adapter a live `signal` plus a synchronous
 * handoff fence. Carrying them in an AsyncLocalStorage scope keeps the
 * authority OUT of the shared, account-cached SDK client, so every physical
 * request can re-check "am I still allowed to dispatch?" immediately before
 * provider I/O. A retired turn throws
 * `PlatformMessageNotDispatchedError` (retryable: false) instead of
 * delivering a stale message.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformMessageNotDispatchedError = void 0;
exports.withFeishuSendContext = withFeishuSendContext;
exports.captureFeishuSendAuthority = captureFeishuSendAuthority;
exports.captureFeishuSendContext = captureFeishuSendContext;
const node_async_hooks_1 = require("node:async_hooks");
const error_runtime_1 = require("openclaw/plugin-sdk/error-runtime");
/** Re-exported so callers can rethrow a retired-turn error unchanged. */
exports.PlatformMessageNotDispatchedError = error_runtime_1.PlatformMessageNotDispatchedError;
const sendScope = new node_async_hooks_1.AsyncLocalStorage();
function buildAssertCurrent(context) {
    const { signal, assertDirectAdapterHandoff } = context;
    return () => {
        try {
            signal?.throwIfAborted();
            assertDirectAdapterHandoff?.();
        }
        catch (cause) {
            throw new error_runtime_1.PlatformMessageNotDispatchedError('Feishu sender retired before request dispatch', {
                cause,
                retryable: false,
            });
        }
    };
}
/**
 * Run a physical send under the host-provided send authority.
 */
function withFeishuSendContext(context, send) {
    const { signal, assertDirectAdapterHandoff, onPlatformSendDispatch } = context;
    if (!signal && !assertDirectAdapterHandoff && !onPlatformSendDispatch) {
        return send();
    }
    return sendScope.run({
        assertCurrent: buildAssertCurrent({ signal, assertDirectAdapterHandoff }),
        onPlatformSendDispatch,
    }, send);
}
/** The ambient authority check, for callers that re-check per attempt. */
function captureFeishuSendAuthority() {
    return sendScope.getStore()?.assertCurrent;
}
function captureFeishuSendContext() {
    return sendScope.getStore();
}
