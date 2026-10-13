"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 飞书工具开发的通用辅助函数
 *
 * 提供所有工具通用的模式，减少重复代码。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResolvedConfig = void 0;
exports.createClientGetter = createClientGetter;
exports.getFirstAccount = getFirstAccount;
exports.createToolContext = createToolContext;
exports.checkToolRegistration = checkToolRegistration;
exports.registerTool = registerTool;
exports.formatToolResult = formatToolResult;
exports.formatToolError = formatToolError;
exports.createToolLogger = createToolLogger;
exports.validateRequiredParams = validateRequiredParams;
exports.validateEnum = validateEnum;
const lark_client_1 = require("../core/lark-client.js");
const tool_client_1 = require("../core/tool-client.js");
const tool_account_1 = require("../core/tool-account.js");
const tools_config_1 = require("../core/tools-config.js");
const api_error_1 = require("../core/api-error.js");
const security_runtime_1 = require("openclaw/plugin-sdk/security-runtime");
// ---------------------------------------------------------------------------
// 配置解析
// ---------------------------------------------------------------------------
// getResolvedConfig is defined in lark-client.ts (core layer) so that both
// tool-client.ts and this file can use it without a circular dependency.
var lark_client_2 = require("../core/lark-client.js");
Object.defineProperty(exports, "getResolvedConfig", { enumerable: true, get: function () { return lark_client_2.getResolvedConfig; } });
// ---------------------------------------------------------------------------
// 客户端管理
// ---------------------------------------------------------------------------
/**
 * 获取飞书客户端的标准模式
 *
 * 这是所有工具通用的逻辑：
 * 1. 优先使用 LarkTicket 中的 accountId 动态解析账号
 * 2. 如果没有 LarkTicket，回退到 accountIndex 指定的账号
 * 3. 返回创建好的客户端实例
 *
 * @param config - OpenClaw 配置对象
 * @param accountIndex - 使用第几个账号（默认 0，即第一个），仅在无 LarkTicket 时使用
 * @returns 飞书 SDK 客户端实例
 * @throws 如果没有启用的账号
 *
 * @example
 * ```typescript
 * export function registerMyTool(api: OpenClawPluginApi) {
 *   const getClient = createClientGetter(api.config);
 *
 *   api.registerTool({
 *     name: "my_tool",
 *     async execute(_toolCallId, params) {
 *       const client = getClient();
 *       const res = await client.im.message.create({ ... });
 *       return formatToolResult(res.data);
 *     }
 *   });
 * }
 * ```
 */
function createClientGetter(config, accountIndex = 0) {
    return (executeParams) => {
        // Account resolution is delegated to the shared, strict resolver so an
        // explicit `params.accountId` is validated and never silently ignored.
        const account = (0, tool_account_1.resolveContextualFeishuToolAccount)(config, accountIndex, executeParams);
        return lark_client_1.LarkClient.fromAccount(account).sdk;
    };
}
/**
 * 获取当前请求对应的飞书账号信息
 *
 * 优先使用 LarkTicket 中的 accountId，回退到第一个启用的账号。
 *
 * @param config - OpenClaw 配置对象
 * @returns 解析后的账号信息
 * @throws 如果没有启用的账号
 *
 * @example
 * ```typescript
 * const account = getFirstAccount(api.config);
 * const client = LarkClient.fromAccount(account);
 * ```
 */
function getFirstAccount(config, executeParams) {
    return (0, tool_account_1.resolveContextualFeishuToolAccount)(config, 0, executeParams);
}
/**
 * 创建工具上下文，一次性返回所有常用的辅助工具
 *
 * 这是推荐的模式，避免在每个工具中重复调用 createClientGetter 和 createToolLogger。
 *
 * @param api - OpenClaw 插件 API
 * @param toolName - 工具名称
 * @param options - 可选配置
 * @returns 工具上下文对象
 *
 * @example
 * ```typescript
 * export function registerMyTool(api: OpenClawPluginApi) {
 *   if (!api.config) return;
 *
 *   const { toolClient, log } = createToolContext(api, "my_tool");
 *
 *   api.registerTool({
 *     name: "my_tool",
 *     async execute(_toolCallId, params) {
 *       const client = getClient();
 *       log.info(`Processing action: ${params.action}`);
 *       const res = await client.im.message.create({ ... });
 *       return formatToolResult(res.data);
 *     }
 *   });
 * }
 * ```
 */
function createToolContext(api, toolName, options) {
    if (!api.config) {
        throw new Error('No config available');
    }
    const config = api.config;
    const accountIndex = options?.accountIndex ?? 0;
    return {
        getClient: createClientGetter(config, accountIndex),
        toolClient: (executeParams) => (0, tool_client_1.createToolClient)(config, { accountIndex, executeParams }),
        log: createToolLogger(api, toolName),
    };
}
// ---------------------------------------------------------------------------
// 工具注册检查
// ---------------------------------------------------------------------------
/**
 * 检查工具是否应该被注册（根据 channels.feishu.tools.deny 配置）。
 *
 * 在工具注册函数开头调用此函数，如果返回 `false` 则应该直接 return。
 *
 * @param api - OpenClaw Plugin API
 * @param toolName - 工具名称
 * @returns `true` 如果应该继续注册，`false` 如果应该跳过
 *
 * @example
 * ```typescript
 * export function registerMyTool(api: OpenClawPluginApi) {
 *   if (!checkToolRegistration(api, 'feishu_my_tool')) {
 *     return;
 *   }
 *
 *   const { toolClient, log } = createToolContext(api, 'feishu_my_tool');
 *   api.registerTool({ ... });
 * }
 * ```
 */
function checkToolRegistration(api, toolName) {
    if (!api.config)
        return false;
    if (!(0, tools_config_1.shouldRegisterTool)(api.config, toolName)) {
        api.logger.debug?.(`${toolName}: Skipped registration (in deny list)`);
        return false;
    }
    return true;
}
/**
 * 包装的工具注册函数，自动检查 channels.feishu.tools.deny 配置。
 *
 * 用法：将 `api.registerTool(...)` 替换为 `registerTool(api, ...)`。
 *
 * @param api - OpenClaw Plugin API
 * @param tool - 工具配置对象或工具工厂函数
 * @param opts - 可选的工具注册选项
 *
 * @example
 * ```typescript
 * // 旧代码：
 * api.registerTool({ name: 'feishu_my_tool', ... });
 *
 * // 新代码：
 * registerTool(api, { name: 'feishu_my_tool', ... });
 * ```
 */
function registerTool(api, tool, opts) {
    // 提取工具名称
    const toolName = typeof tool === 'function' ? tool.name : tool.name;
    if (!toolName) {
        // 如果无法提取工具名，直接注册（不拦截）
        api.registerTool(augmentFeishuTool(tool), opts);
        return true;
    }
    // 检查是否应该注册
    if (!checkToolRegistration(api, toolName)) {
        return false;
    }
    // 通过检查，注册增强后的工具（见 augmentFeishuTool）
    api.registerTool(augmentFeishuTool(tool), opts);
    return true;
}
/**
 * Augment a tool so that per-call `accountId` routing is reachable:
 *
 * - `parameters` gains an optional `accountId` property (per union variant);
 * - `execute` runs inside the per-tool-call param scope so the client getters
 *   can read the raw params without every tool body threading them through.
 *
 * This is applied at the single registration choke point, so it covers every
 * tool without editing 36 `execute` bodies. Function-form tool factories are
 * wrapped recursively. Tools without an `execute` are passed through untouched.
 */
function augmentFeishuTool(tool) {
    if (typeof tool === 'function') {
        return (...args) => augmentFeishuTool(tool(...args));
    }
    if (!tool || typeof tool !== 'object' || typeof tool.execute !== 'function') {
        return tool;
    }
    const originalExecute = tool.execute;
    return {
        ...tool,
        parameters: (0, tool_account_1.withAccountIdToolParam)(tool.parameters),
        // Forward every argument the host supplies (toolCallId, params, signal,
        // onUpdate, …) so cancellation/streaming callbacks are never dropped.
        execute(...args) {
            return (0, tool_account_1.withFeishuToolCallParams)(args[1], () => originalExecute.call(tool, ...args));
        },
    };
}
// ---------------------------------------------------------------------------
// 返回值格式化
// ---------------------------------------------------------------------------
/**
 * 格式化工具返回值为 OpenClaw 期望的格式
 *
 * @param data - 要返回的数据（会被序列化为 JSON）
 * @param options - 可选配置
 * @returns OpenClaw 工具返回值格式
 *
 * @example
 * ```typescript
 * // 简单使用
 * return formatToolResult({ success: true, user_id: "ou_xxx" });
 *
 * // 自定义 JSON 格式化
 * return formatToolResult(data, { indent: 4 });
 * ```
 */
function formatToolResult(data, options = {}) {
    const { indent = 2 } = options;
    const text = JSON.stringify(data, null, indent) ?? '';
    return {
        content: [
            {
                // Fence untrusted Feishu payloads so a hostile doc/message cannot
                // smuggle instructions into the model. Only the model-visible
                // text is wrapped; `details` keeps the exact remote payload.
                // Ported from @openclaw/feishu `feishuExternalToolResult`.
                type: 'text',
                text: (0, security_runtime_1.wrapExternalContent)(text, { source: 'api', includeWarning: false }),
            },
        ],
        details: data, // 始终包含 details
    };
}
/**
 * 格式化错误为工具返回值
 *
 * @param error - 错误对象或字符串
 * @param context - 错误上下文信息（可选）
 * @returns 包含错误信息的工具返回值
 *
 * @example
 * ```typescript
 * try {
 *   const res = await client.im.message.create({ ... });
 *   return formatToolResult(res.data);
 * } catch (err) {
 *   return formatToolError(err, { action: "send_message", user_id: "ou_xxx" });
 * }
 * ```
 */
function formatToolError(error, context) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Surface structured Feishu error metadata (http status / business code /
    // msg / log_id) so scope-missing (99991672) and similar failures are
    // diagnosable without raw logs. Ported from @openclaw/feishu `tool-result.ts`.
    const meta = (0, api_error_1.extractFeishuApiErrorMeta)(error);
    const structuredMeta = {};
    if (meta.httpStatus !== undefined)
        structuredMeta.http_status = meta.httpStatus;
    if (meta.feishuCode !== undefined)
        structuredMeta.feishu_code = meta.feishuCode;
    if (meta.feishuMsg !== undefined)
        structuredMeta.feishu_msg = meta.feishuMsg;
    if (meta.feishuLogId !== undefined)
        structuredMeta.feishu_log_id = meta.feishuLogId;
    return formatToolResult({
        error: errorMsg,
        ...structuredMeta,
        ...context,
    });
}
// ---------------------------------------------------------------------------
// 日志辅助
// ---------------------------------------------------------------------------
/**
 * 创建带工具名前缀的日志函数
 *
 * @param api - OpenClaw 插件 API
 * @param toolName - 工具名称
 * @returns 日志函数对象
 *
 * @example
 * ```typescript
 * export function registerMyTool(api: OpenClawPluginApi) {
 *   const log = createToolLogger(api, "my_tool");
 *
 *   log.info("Tool started");
 *   log.warn("Missing optional param: user_id");
 *   log.error("API call failed");
 *   log.debug("Intermediate state", { count: 5 });
 * }
 * ```
 */
function createToolLogger(api, toolName) {
    const prefix = `${toolName}:`;
    return {
        info: (msg) => {
            if (api.logger.info) {
                api.logger.info(`${prefix} ${msg}`);
            }
        },
        warn: (msg) => {
            if (api.logger.warn) {
                api.logger.warn(`${prefix} ${msg}`);
            }
        },
        error: (msg) => {
            if (api.logger.error) {
                api.logger.error(`${prefix} ${msg}`);
            }
        },
        debug: (msg) => {
            if (api.logger.debug) {
                api.logger.debug(`${prefix} ${msg}`);
            }
        },
    };
}
// ---------------------------------------------------------------------------
// 参数校验
// ---------------------------------------------------------------------------
/**
 * 校验必填参数
 *
 * @param params - 参数对象
 * @param requiredFields - 必填字段列表
 * @returns 校验结果，如果有缺失字段则返回错误信息
 *
 * @example
 * ```typescript
 * async execute(_toolCallId, params) {
 *   const error = validateRequiredParams(params, ["action", "user_id"]);
 *   if (error) return formatToolResult(error);
 *
 *   // 继续处理...
 * }
 * ```
 */
function validateRequiredParams(params, requiredFields) {
    const missing = requiredFields.filter((field) => {
        const value = params[field];
        return value === undefined || value == null || value === '';
    });
    if (missing.length > 0) {
        return {
            error: `Missing required parameter(s): ${missing.join(', ')}`,
            missing,
        };
    }
    return null;
}
/**
 * 校验枚举值
 *
 * @param value - 要校验的值
 * @param allowedValues - 允许的值列表
 * @param fieldName - 字段名（用于错误提示）
 * @returns 校验结果，如果值不在允许列表中则返回错误信息
 *
 * @example
 * ```typescript
 * const error = validateEnum(params.action, ["create", "list", "delete"], "action");
 * if (error) return formatToolResult(error);
 * ```
 */
function validateEnum(value, allowedValues, fieldName) {
    if (!allowedValues.includes(value)) {
        return {
            error: `Invalid value for ${fieldName}: ${value}`,
            allowed: allowedValues,
        };
    }
    return null;
}
