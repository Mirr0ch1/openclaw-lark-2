"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tool Scopes 配置
 *
 * 定义所有工具动作所需的飞书权限映射。
 *
 * ## 维护方式
 *
 * ⚠️ 此文件采用**手动维护**，新增或修改工具时需同步更新。
 *
 * ### 新增工具动作
 *
 * 1. 在 `ToolActionKey` 类型中添加新键：
 *    ```typescript
 *    export type ToolActionKey =
 *      | "feishu_calendar_event.create"
 *      | "feishu_new_tool.action"  // 新增
 *    ```
 *
 * 2. 在 `TOOL_SCOPES` 对象中添加对应配置：
 *    ```typescript
 *    export const TOOL_SCOPES: ToolScopeMapping = {
 *      "feishu_new_tool.action": [
 *        "required:scope:here"
 *      ],
 *    };
 *    ```
 *
 * 3. 运行 TypeScript 类型检查验证一致性：
 *    ```bash
 *    cd openclaw/feishu && npx tsc --noEmit
 *    ```
 *
 * ### 如何确定所需 Scope
 *
 * 1. **查阅飞书开放平台 API 文档**：https://open.feishu.cn/document
 * 2. **使用 feishu-oapi-search skill**：在 Claude Code 中搜索 API 文档
 * 3. **参考类似工具**：查看功能相近的工具的 scope 配置
 * 4. **实际测试**：观察 API 调用的错误码（LARK_ERROR.APP_SCOPE_MISSING/99991672=应用缺权限，LARK_ERROR.USER_SCOPE_INSUFFICIENT/99991679=用户缺授权）
 *
 * 最后更新: 2026-03-03
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENSITIVE_SCOPES = exports.REQUIRED_APP_SCOPES = exports.TOOL_SCOPES = void 0;
exports.filterSensitiveScopes = filterSensitiveScopes;
// ===== 数据 =====
/**
 * Tool Scope 数据
 *
 * 每个工具动作所需的飞书权限列表（Required Scopes）
 *
 * ## 数据说明
 *
 * - 空数组 `[]` 表示该工具动作不需要任何权限
 * - 多个权限表示需要同时拥有所有权限（AND 关系）
 * - 所有 scope 都是 user scopes（用户级权限）
 *
 * ## 示例
 *
 * ```typescript
 * TOOL_SCOPES["feishu_calendar_event.create"]
 * // 返回: ["calendar:calendar.event:create", "calendar:calendar.event:update"]
 * ```
 *
 * @see {@link ToolActionKey} 所有可用的工具动作键
 */
exports.TOOL_SCOPES = {
    // Empty by design: the plugin registers exactly one tool (feishu_auth),
    // which needs no app scope. Every Lark business operation now runs through
    // lark-cli, so scope requirements live with that app, not here.
};
// ===== 必需的应用身份权限 =====
/**
 * 飞书插件运行必须开通的应用身份权限清单
 *
 * 这些权限是插件基础功能（消息接收、卡片交互、基本信息查询等）所必需的，
 * 如果缺失这些权限，插件将无法正常工作。
 *
 * 权限分类：
 * - im:message.* - 消息接收和发送
 * - im:chat.* - 群聊管理
 * - im:resource - 消息资源（图片、文件等）
 * - cardkit:card.* - 卡片交互
 * - application:application:self_manage - 应用自身权限查询（权限检查基础）
 * - contact:contact.base:readonly - 通讯录基础信息
 * - docx:document:readonly - 文档基础只读（文档链接预览等）
 *
 * 最后更新: 2026-03-03
 */
exports.REQUIRED_APP_SCOPES = [
    'contact:contact.base:readonly',
    'docx:document:readonly',
    'im:chat:read',
    'im:chat:update',
    'im:message.group_at_msg:readonly',
    'im:message.p2p_msg:readonly',
    'im:message.pins:read',
    'im:message.pins:write_only',
    'im:message.reactions:read',
    'im:message.reactions:write_only',
    'im:message:readonly',
    'im:message:recall',
    'im:message:send_as_bot',
    'im:message:send_multi_users',
    'im:message:send_sys_msg',
    'im:message:update',
    'im:resource',
    'application:application:self_manage',
    'cardkit:card:write',
    'cardkit:card:read',
];
/**
 * 必需权限用途说明
 *
 * 描述每个必需权限的具体用途，帮助管理员理解为什么需要开通该权限。
 */
// ===== 高敏感权限 =====
/**
 * 高敏感权限清单
 *
 * 这些权限具有较高的敏感度，不应在批量授权时自动申请。
 * 用户需要明确知晓这些权限的影响后，才能手动授权。
 *
 * 权限说明：
 * - im:message.send_as_user - 以用户身份发送消息（高风险，可能被滥用发送钓鱼或垃圾消息）
 * - space:document:delete - 删除云文档
 * - calendar:calendar.event:delete - 删除日程
 * - base:table:delete - 删除多维表格数据表
 *
 * 使用场景：
 * - 批量授权时会自动过滤掉这些权限
 * - 需要这些权限的功能会单独提示用户授权
 *
 * 最后更新: 2026-03-17
 */
exports.SENSITIVE_SCOPES = [
    'im:message.send_as_user',
    'space:document:delete',
    'calendar:calendar.event:delete',
    'base:table:delete',
];
/**
 * 过滤掉高敏感权限
 *
 * 用于批量授权时排除高敏感权限，这些权限需要用户明确授权。
 *
 * @param scopes - 原始权限列表
 * @returns 过滤后的权限列表（不包含高敏感权限）
 *
 * @example
 * ```typescript
 * const allScopes = ["im:message", "im:message.send_as_user", "calendar:calendar:read"];
 * const safeScopes = filterSensitiveScopes(allScopes);
 * // 返回: ["im:message", "calendar:calendar:read"]
 * ```
 */
function filterSensitiveScopes(scopes) {
    const sensitiveSet = new Set(exports.SENSITIVE_SCOPES);
    return scopes.filter((scope) => !sensitiveSet.has(scope));
}
// ===== 统计信息 =====
/**
 * 工具动作总数: 96
 * 唯一 scope 总数: 74
 * 必需应用权限总数: 20
 * 高敏感权限总数: 4
 */
