/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * /feishu larkcli [status|sync] — account -> lark-cli profile mapping surface.
 */
export interface LarkcliCommandOptions {
    action?: 'status' | 'sync';
    force?: boolean;
    locale?: 'zh_cn' | 'en_us';
}
/** Render the mapping health (status) or create/repair profiles (sync). */
export declare function runFeishuLarkcli(cfg: unknown, opts?: LarkcliCommandOptions): Promise<string>;
