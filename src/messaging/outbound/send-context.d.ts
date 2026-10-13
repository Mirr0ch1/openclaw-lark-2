/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Outbound send authority scope (ported from @openclaw/feishu send-context.ts).
 */
export interface FeishuSendContext {
    signal?: AbortSignal;
    assertDirectAdapterHandoff?: () => void;
    onPlatformSendDispatch?: () => Promise<void>;
}
export interface FeishuSendScope {
    assertCurrent: () => void;
    onPlatformSendDispatch?: () => Promise<void>;
}
/** Re-exported so callers can rethrow a retired-turn error unchanged. */
export declare const PlatformMessageNotDispatchedError: typeof import("openclaw/plugin-sdk/error-runtime").PlatformMessageNotDispatchedError;
/** Run a physical send under the host-provided send authority. */
export declare function withFeishuSendContext<T>(context: FeishuSendContext, send: () => Promise<T>): Promise<T>;
/** The ambient authority check, for callers that re-check per attempt. */
export declare function captureFeishuSendAuthority(): (() => void) | undefined;
export declare function captureFeishuSendContext(): FeishuSendScope | undefined;
