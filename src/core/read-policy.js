"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Read authorization for Feishu tools.
 *
 * Ported from @openclaw/feishu `src/read-policy.ts`.
 *
 * The official implementation derives its read context from the host's
 * `ChannelMessageActionContext` / `OpenClawPluginToolContext`. This plugin's
 * tools only receive `(toolCallId, params, …)`, so the context is reconstructed
 * from the active {@link LarkTicket} (account + current chat + requester) —
 * which is exactly what the inbound path already establishes.
 *
 * Policy summary:
 *  - group reads: allowed when the account's group policy is `open`, the group
 *    is explicitly configured, or the chat id is in `groupAllowFrom`;
 *  - the current conversation is always readable;
 *  - other direct (p2p) reads require a full `allowFrom` wildcard — i.e. an
 *    operator must have opted into universal peer enumeration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeishuReadContext = resolveFeishuReadContext;
exports.normalizeFeishuChatType = normalizeFeishuChatType;
exports.resolveFeishuChatType = resolveFeishuChatType;
exports.isCurrentFeishuChat = isCurrentFeishuChat;
exports.isFeishuGroupReadAllowed = isFeishuGroupReadAllowed;
exports.isFeishuGroupReadEnabled = isFeishuGroupReadEnabled;
exports.canEnumerateAllFeishuPeers = canEnumerateAllFeishuPeers;
exports.resolveFeishuChatReadPreliminaryAuthorization = resolveFeishuChatReadPreliminaryAuthorization;
exports.assertFeishuChatReadAllowed = assertFeishuChatReadAllowed;
exports.readFeishuChatInfoWithAuthorization = readFeishuChatInfoWithAuthorization;
exports.authorizeFeishuChatMemberRead = authorizeFeishuChatMemberRead;
const allow_from_1 = require("openclaw/plugin-sdk/allow-from");
const channel_actions_1 = require("openclaw/plugin-sdk/channel-actions");
const runtime_group_policy_1 = require("openclaw/plugin-sdk/runtime-group-policy");
const lark_ticket_1 = require("./lark-ticket.js");
const targets_1 = require("./targets.js");
const policy_1 = require("../messaging/inbound/policy.js");
const DENIED_MESSAGE = 'Feishu read target is not allowed.';
// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
/**
 * Reconstruct the read context from the active LarkTicket. Explicit overrides
 * win so callers that do have richer context can pass it through.
 */
function resolveFeishuReadContext(override) {
    const ticket = (0, lark_ticket_1.getTicket)();
    return {
        accountId: override?.accountId ?? ticket?.accountId,
        currentChannelId: override?.currentChannelId ?? ticket?.chatId,
        requesterAccountId: override?.requesterAccountId ?? ticket?.accountId,
        requesterSenderId: override?.requesterSenderId ?? ticket?.senderOpenId,
        currentChatType: override?.currentChatType ?? ticket?.chatType,
        directOperator: override?.directOperator ?? false,
    };
}
/** Canonicalise a chat id for comparison (strips routing prefixes). */
function normalizeChatId(raw) {
    if (!raw)
        return '';
    return (0, targets_1.normalizeFeishuTarget)(raw) ?? String(raw).trim();
}
/** Normalise one allowlist entry for case-insensitive comparison. */
function normalizeFeishuAllowEntry(entry) {
    return String(entry ?? '').trim().toLowerCase();
}
function normalizeFeishuAllowlist(entries) {
    return (entries ?? []).map((entry) => normalizeFeishuAllowEntry(String(entry))).filter(Boolean);
}
function hasExplicitFeishuGroupConfig(cfg, groupId) {
    return (0, policy_1.resolveFeishuGroupConfig)({ cfg, groupId }) !== undefined;
}
/** Normalise a Feishu chat type to the two shapes the policy reasons about. */
function normalizeFeishuChatType(raw) {
    if (raw === 'group' || raw === 'topic_group')
        return 'group';
    if (raw === 'p2p')
        return 'p2p';
    return undefined;
}
/** `im.chat.get` reports a topic group via `chat_mode: "topic"`. */
function normalizeFeishuChatMode(raw) {
    return raw === 'topic' ? 'group' : normalizeFeishuChatType(raw);
}
/**
 * Resolve the chat type from a Feishu chat-info payload.
 *
 * `im.chat.get` uses `chat_mode` for the conversation kind; `chat_type` is the
 * public/private VISIBILITY classification. Older shapes may still expose
 * p2p/group there, so fall back to it while ignoring privacy-only values.
 * Mirrors official `chat-type.ts`.
 */
function resolveFeishuChatType(chat) {
    return (normalizeFeishuChatMode(chat?.chat_mode) ?? normalizeFeishuChatType(chat?.chat_type));
}
function isCurrentChat(params) {
    const context = params.ctx;
    return (context.requesterAccountId === params.account.accountId &&
        (context.accountId ?? params.account.accountId) === params.account.accountId &&
        normalizeChatId(context.currentChannelId) === normalizeChatId(params.chatId));
}
/** Whether `chatId` is the conversation the current request originates from. */
function isCurrentFeishuChat(params) {
    return isCurrentChat({
        account: params.account,
        chatId: params.chatId,
        ctx: params.ctx ?? resolveFeishuReadContext(),
    });
}
// ---------------------------------------------------------------------------
// Group read policy
// ---------------------------------------------------------------------------
function resolveFeishuReadGroupPolicy(cfg, account) {
    return (0, runtime_group_policy_1.resolveOpenProviderRuntimeGroupPolicy)({
        providerConfigPresent: cfg?.channels?.feishu !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy: (0, runtime_group_policy_1.resolveDefaultGroupPolicy)(cfg),
    }).groupPolicy;
}
/** Whether a group chat may be read. */
function isFeishuGroupReadAllowed(cfg, account, chatId, current) {
    const policy = resolveFeishuReadGroupPolicy(cfg, account);
    if (policy === 'disabled')
        return false;
    const group = (0, policy_1.resolveFeishuGroupConfig)({ cfg: account.config, groupId: chatId });
    if (group?.enabled === false)
        return false;
    if (current || policy === 'open')
        return true;
    const explicitlyConfigured = hasExplicitFeishuGroupConfig(account.config, chatId);
    const normalizedChatId = normalizeFeishuAllowEntry(chatId);
    return (explicitlyConfigured ||
        (0, allow_from_1.resolveAllowlistMatchByCandidates)({
            allowList: normalizeFeishuAllowlist(account.config.groupAllowFrom),
            candidates: [{ value: normalizedChatId, source: 'id' }],
        }).allowed);
}
/** Whether a group chat may be read treating it as the current conversation. */
function isFeishuGroupReadEnabled(cfg, account, chatId) {
    return isFeishuGroupReadAllowed(cfg, account, chatId, true);
}
/**
 * Feishu's canonical schema has no "disabled DM" mode; account/channel enabled
 * owns shutdown. Account overrides merge field-by-field, so only an `allowFrom`
 * wildcard proves universal non-current access under every ingress policy.
 */
function canEnumerateAllFeishuPeers(account) {
    return (0, allow_from_1.compileAllowlist)(normalizeFeishuAllowlist(account.config.allowFrom)).wildcard;
}
// ---------------------------------------------------------------------------
// Chat read authorization
// ---------------------------------------------------------------------------
/**
 * Preliminary (pre-metadata) authorization decision.
 *
 * Returns `needs-metadata` when the answer depends on whether the target is a
 * group or a direct chat — the caller must fetch chat info to resolve it.
 */
function resolveFeishuChatReadPreliminaryAuthorization(params) {
    const chatId = normalizeChatId(params.chatId);
    const resolvedChatType = normalizeFeishuChatType(params.chatType);
    const knownGroup = resolvedChatType === 'group' ||
        (params.chatType === undefined &&
            hasExplicitFeishuGroupConfig(params.account.config, chatId));
    const knownDm = resolvedChatType === 'p2p';
    const current = isCurrentChat({ account: params.account, chatId, ctx: params.ctx });
    const directOperator = params.ctx.directOperator === true;
    const groupAllowed = directOperator
        ? isFeishuGroupReadEnabled(params.cfg, params.account, chatId)
        : isFeishuGroupReadAllowed(params.cfg, params.account, chatId, current);
    const dmAllowed = directOperator || current || canEnumerateAllFeishuPeers(params.account);
    if (knownGroup) {
        return { chatId, decision: groupAllowed ? 'allow' : 'deny' };
    }
    if (knownDm) {
        return { chatId, decision: dmAllowed ? 'allow' : 'deny' };
    }
    if (groupAllowed === dmAllowed) {
        return { chatId, decision: groupAllowed ? 'allow' : 'deny' };
    }
    return { chatId, decision: 'needs-metadata' };
}
/** Assert that a chat read is allowed; returns the normalized chat id. */
function assertFeishuChatReadAllowed(params) {
    const authorization = resolveFeishuChatReadPreliminaryAuthorization(params);
    if (authorization.decision !== 'allow') {
        throw new channel_actions_1.ToolAuthorizationError(DENIED_MESSAGE);
    }
    return authorization.chatId;
}
/**
 * Read chat info under authorization, resolving the `needs-metadata` case
 * without leaking an existence oracle: a lookup failure is only re-thrown as a
 * denial when the type was genuinely required.
 */
async function readFeishuChatInfoWithAuthorization(params, readChatInfo) {
    let chat;
    try {
        chat = await readChatInfo(params.preliminary.chatId);
    }
    catch (error) {
        if (params.preliminary.decision === 'needs-metadata') {
            assertFeishuChatReadAllowed({
                cfg: params.cfg,
                account: params.account,
                ctx: params.ctx,
                chatId: params.preliminary.chatId,
            });
        }
        throw error;
    }
    assertFeishuChatReadAllowed({
        cfg: params.cfg,
        account: params.account,
        ctx: params.ctx,
        chatId: params.preliminary.chatId,
        chatType: resolveFeishuChatType(chat),
    });
    return chat;
}
/**
 * Authorize a chat-member read. Group chats allow full enumeration; direct
 * chats are restricted to the current sender only.
 */
function authorizeFeishuChatMemberRead(params) {
    const chatId = assertFeishuChatReadAllowed(params);
    const chatType = normalizeFeishuChatType(params.chatType);
    if (chatType === 'group') {
        return { kind: 'group', chatId };
    }
    if (chatType !== 'p2p') {
        throw new channel_actions_1.ToolAuthorizationError('Feishu chat member reads require a known chat type.');
    }
    if (!isCurrentChat({ account: params.account, chatId, ctx: params.ctx })) {
        throw new channel_actions_1.ToolAuthorizationError('Feishu direct-chat member reads require the current conversation.');
    }
    const requesterSenderId = normalizeChatId(params.ctx.requesterSenderId);
    if (!requesterSenderId) {
        throw new channel_actions_1.ToolAuthorizationError('Feishu direct-chat member identity is unavailable.');
    }
    const requesterSenderIdType = (0, targets_1.detectIdType)(requesterSenderId);
    if (requesterSenderIdType !== 'open_id' && requesterSenderIdType !== 'user_id') {
        throw new channel_actions_1.ToolAuthorizationError('Feishu direct-chat member identity type is unavailable.');
    }
    if (params.memberIdType && params.memberIdType !== requesterSenderIdType) {
        throw new channel_actions_1.ToolAuthorizationError('Feishu direct-chat member identifier type must match the current sender.');
    }
    if (params.memberId && normalizeChatId(params.memberId) !== requesterSenderId) {
        throw new channel_actions_1.ToolAuthorizationError('Feishu direct-chat member reads are limited to the current sender.');
    }
    return {
        kind: 'direct',
        chatId,
        memberId: requesterSenderId,
        memberIdType: requesterSenderIdType,
    };
}
