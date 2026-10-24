/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_auth — the plugin's only remaining tool: drives lark-cli's device flow
 * and renders the authorization link as a Feishu card.
 */
export type FeishuAuthAction = 'authorize' | 'complete' | 'status' | 'revoke';
export interface FeishuAuthParams {
    action: FeishuAuthAction;
    device_code?: string;
    accountId?: string;
}
export declare function registerFeishuAuthTool(api: unknown): void;
