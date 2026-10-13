"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_chat_members tool -- 获取群成员列表
 *
 * 获取指定群组的成员信息，包括成员名字与 ID
 * 使用 sdk.im.v1.chatMembers.get 接口
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatMembersTool = registerChatMembersTool;
const typebox_1 = require("@sinclair/typebox");
const channel_actions_1 = require("openclaw/plugin-sdk/channel-actions");
const helpers_1 = require("../helpers.js");
const read_policy_1 = require("../../../core/read-policy.js");
// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const ChatMembersSchema = typebox_1.Type.Object({
    chat_id: typebox_1.Type.String({
        description: '群 ID（格式如 oc_xxx）。' + '可以通过 feishu_chat_search 工具搜索获取',
    }),
    member_id_type: typebox_1.Type.Optional((0, helpers_1.StringEnum)(['open_id', 'union_id', 'user_id'])),
    page_size: typebox_1.Type.Optional(typebox_1.Type.Integer({
        description: '分页大小（默认20）',
        minimum: 1,
    })),
    page_token: typebox_1.Type.Optional(typebox_1.Type.String({
        description: '分页标记。首次请求无需填写',
    })),
});
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function registerChatMembersTool(api) {
    if (!api.config)
        return false;
    const cfg = api.config;
    const { toolClient, log } = (0, helpers_1.createToolContext)(api, 'feishu_chat_members');
    return (0, helpers_1.registerTool)(api, {
        name: 'feishu_chat_members',
        label: 'Feishu: Get Chat Members',
        description: '以用户的身份获取指定群组的成员列表。' +
            '返回成员信息，包含成员 ID、姓名等。' +
            '注意：不会返回群组内的机器人成员。',
        parameters: ChatMembersSchema,
        async execute(_toolCallId, params) {
            const p = params;
            try {
                const client = toolClient(p);
                log.info(`chat_members: chat_id="${p.chat_id}", page_size=${p.page_size ?? 20}`);
                // Read authorization (ported from @openclaw/feishu read-policy):
                // group chats enumerate members freely once readable; direct chats are
                // limited to the current sender. The chat type comes from the ticket
                // for the current conversation, otherwise from an authorized lookup.
                const readCtx = (0, read_policy_1.resolveFeishuReadContext)();
                let chatType;
                if ((0, read_policy_1.isCurrentFeishuChat)({ account: client.account, chatId: p.chat_id, ctx: readCtx })) {
                    chatType = readCtx.currentChatType;
                }
                if (!chatType) {
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
                        const infoRes = await client.invoke('feishu_chat.get', (sdk, opts) => sdk.im.v1.chat.get({
                            path: { chat_id: chatId },
                            params: { user_id_type: p.member_id_type || 'open_id' },
                        }, {
                            ...(opts ?? {}),
                            headers: {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                ...(opts?.headers ?? {}),
                                'X-Chat-Custom-Header': 'enable_chat_list_security_check',
                            },
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        }), { as: 'user' });
                        (0, helpers_1.assertLarkOk)(infoRes);
                        return infoRes.data;
                    });
                    chatType = (0, read_policy_1.resolveFeishuChatType)(chat);
                }
                const authorization = (0, read_policy_1.authorizeFeishuChatMemberRead)({
                    cfg,
                    account: client.account,
                    ctx: readCtx,
                    chatId: p.chat_id,
                    chatType,
                    memberIdType: p.member_id_type,
                });
                if (authorization.kind === 'direct') {
                    // A direct chat only ever exposes the current sender.
                    return (0, helpers_1.json)({
                        items: [
                            { member_id: authorization.memberId, member_id_type: authorization.memberIdType },
                        ],
                        has_more: false,
                        member_total: 1,
                    });
                }
                const res = await client.invoke('feishu_chat_members.default', (sdk, opts) => sdk.im.v1.chatMembers.get({
                    path: { chat_id: p.chat_id },
                    params: {
                        member_id_type: p.member_id_type || 'open_id',
                        page_size: p.page_size,
                        page_token: p.page_token,
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
                const data = res.data;
                const memberCount = data?.items?.length ?? 0;
                const memberTotal = data?.member_total ?? 0;
                log.info(`chat_members: found ${memberCount} members (total: ${memberTotal})`);
                return (0, helpers_1.json)({
                    items: data?.items,
                    has_more: data?.has_more ?? false,
                    page_token: data?.page_token,
                    member_total: memberTotal,
                });
            }
            catch (err) {
                // A read-authorization denial must surface as a hard tool error.
                if (err instanceof channel_actions_1.ToolAuthorizationError)
                    throw err;
                return await (0, helpers_1.handleInvokeErrorWithAutoAuth)(err, cfg);
            }
        },
    }, { name: 'feishu_chat_members' });
}
