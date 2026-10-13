"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_chat tool -- 管理飞书群聊
 *
 * Actions:
 *   - search: 搜索对用户或机器人可见的群列表
 *   - get:    获取指定群的详细信息
 *
 * Uses the Feishu IM v1 API:
 *   - search: GET /open-apis/im/v1/chats/search
 *   - get:    GET /open-apis/im/v1/chats/:chat_id
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatSearchTool = registerChatSearchTool;
const typebox_1 = require("@sinclair/typebox");
const channel_actions_1 = require("openclaw/plugin-sdk/channel-actions");
const helpers_1 = require("../helpers.js");
const read_policy_1 = require("../../../core/read-policy.js");
// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const FeishuChatSchema = typebox_1.Type.Union([
    // SEARCH
    typebox_1.Type.Object({
        action: typebox_1.Type.Literal('search'),
        query: typebox_1.Type.String({
            description: '搜索关键词（必填）。支持匹配群名称、群成员名称。' + '支持多语种、拼音、前缀等模糊搜索。',
        }),
        page_size: typebox_1.Type.Optional(typebox_1.Type.Integer({
            description: '分页大小（默认20）',
            minimum: 1,
        })),
        page_token: typebox_1.Type.Optional(typebox_1.Type.String({
            description: '分页标记。首次请求无需填写',
        })),
        user_id_type: typebox_1.Type.Optional((0, helpers_1.StringEnum)(['open_id', 'union_id', 'user_id'], {
            description: '用户 ID 类型（默认 open_id）',
        })),
    }),
    // GET
    typebox_1.Type.Object({
        action: typebox_1.Type.Literal('get'),
        chat_id: typebox_1.Type.String({
            description: '群 ID（格式如 oc_xxx）',
        }),
        user_id_type: typebox_1.Type.Optional((0, helpers_1.StringEnum)(['open_id', 'union_id', 'user_id'], {
            description: '用户 ID 类型（默认 open_id）',
        })),
    }),
]);
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function registerChatSearchTool(api) {
    if (!api.config)
        return false;
    const cfg = api.config;
    const { toolClient, log } = (0, helpers_1.createToolContext)(api, 'feishu_chat');
    return (0, helpers_1.registerTool)(api, {
        name: 'feishu_chat',
        label: 'Feishu: Chat Management',
        description: '以用户身份调用飞书群聊管理工具。Actions: search（搜索群列表，支持关键词匹配群名称、群成员）, get（获取指定群的详细信息，包括群名称、描述、头像、群主、权限配置等）。',
        parameters: FeishuChatSchema,
        async execute(_toolCallId, params) {
            const p = params;
            try {
                const client = toolClient(p);
                switch (p.action) {
                    // -----------------------------------------------------------------
                    // SEARCH
                    // -----------------------------------------------------------------
                    case 'search': {
                        log.info(`search: query="${p.query}", page_size=${p.page_size ?? 20}`);
                        const res = await client.invoke('feishu_chat.search', (sdk, opts) => sdk.im.v1.chat.search({
                            params: {
                                user_id_type: p.user_id_type || 'open_id',
                                query: p.query,
                                page_size: p.page_size,
                                page_token: p.page_token,
                            },
                        }, opts), { as: 'user' });
                        (0, helpers_1.assertLarkOk)(res);
                        const data = res.data;
                        const chatCount = data?.items?.length ?? 0;
                        log.info(`search: found ${chatCount} chats`);
                        return (0, helpers_1.json)({
                            items: data?.items,
                            has_more: data?.has_more ?? false,
                            page_token: data?.page_token,
                        });
                    }
                    // -----------------------------------------------------------------
                    // GET
                    // -----------------------------------------------------------------
                    case 'get': {
                        log.info(`get: chat_id=${p.chat_id}, user_id_type=${p.user_id_type ?? 'open_id'}`);
                        // Read authorization (ported from @openclaw/feishu read-policy):
                        // the current conversation is always readable; other chats must be
                        // permitted by the account's group policy / DM allowlist.
                        const readCtx = (0, read_policy_1.resolveFeishuReadContext)();
                        const preliminary = (0, read_policy_1.resolveFeishuChatReadPreliminaryAuthorization)({
                            cfg,
                            account: client.account,
                            ctx: readCtx,
                            chatId: p.chat_id,
                        });
                        if (preliminary.decision === 'deny') {
                            (0, read_policy_1.assertFeishuChatReadAllowed)({
                                cfg,
                                account: client.account,
                                ctx: readCtx,
                                chatId: preliminary.chatId,
                            });
                        }
                        const chat = await (0, read_policy_1.readFeishuChatInfoWithAuthorization)({
                            cfg,
                            account: client.account,
                            ctx: readCtx,
                            preliminary,
                        }, async (chatId) => {
                            const res = await client.invoke('feishu_chat.get', (sdk, opts) => sdk.im.v1.chat.get({
                                path: {
                                    chat_id: chatId,
                                },
                                params: {
                                    user_id_type: p.user_id_type || 'open_id',
                                },
                            }, {
                                ...(opts ?? {}),
                                headers: {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    ...(opts?.headers ?? {}),
                                    'X-Chat-Custom-Header': 'enable_chat_list_security_check',
                                },
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            }), { as: 'user' });
                            (0, helpers_1.assertLarkOk)(res);
                            return res.data;
                        });
                        log.info(`get: retrieved chat info for ${p.chat_id}`);
                        return (0, helpers_1.json)({
                            chat,
                        });
                    }
                }
            }
            catch (err) {
                // A read-authorization denial must surface as a hard tool error,
                // not be swallowed into a generic error result.
                if (err instanceof channel_actions_1.ToolAuthorizationError)
                    throw err;
                return await (0, helpers_1.handleInvokeErrorWithAutoAuth)(err, cfg);
            }
        },
    }, { name: 'feishu_chat' });
}
