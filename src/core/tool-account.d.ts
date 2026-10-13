/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Per-call Feishu account routing for tools.
 *
 * Ported (trimmed) from @openclaw/feishu `src/tool-account.ts`.
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import type { ConfiguredLarkAccount } from './types';
/** Run a tool execution under its raw call params. */
export declare function withFeishuToolCallParams<T>(params: unknown, fn: () => T): T;
/** The raw params of the tool call currently executing, if any. */
export declare function getFeishuToolCallParams(): Record<string, unknown> | undefined;
/**
 * Resolve the Feishu account a tool call should run against.
 * Throws when a requested account is unknown / unconfigured / disabled, or
 * when no usable account exists.
 */
export declare function resolveFeishuToolAccount(params: {
    config: ClawdbotConfig;
    executeParams?: Record<string, unknown>;
    defaultAccountId?: string;
    accountIndex?: number;
}): ConfiguredLarkAccount;
/** Resolve the account for the tool call currently executing. */
export declare function resolveContextualFeishuToolAccount(config: ClawdbotConfig, accountIndex?: number, executeParams?: Record<string, unknown>): ConfiguredLarkAccount;
/** The optional TypeBox `accountId` property added to every tool schema. */
export declare function accountIdToolParameter(): unknown;
/** Add an optional `accountId` to every object variant of a tool schema. */
export declare function withAccountIdToolParam<T>(parameters: T): T;
