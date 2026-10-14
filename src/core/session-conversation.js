"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu session-conversation grammar.
 *
 * Ported from @openclaw/feishu `src/session-conversation.ts` (openclaw main 2f620b9).
 *
 * Core calls `messaging.resolveSessionConversation({kind, rawId})` when it needs
 * the provider's own session grammar: how a raw conversation id encodes
 * thread/topic/sender scoping, and which parent conversations to fall back to
 * (used for per-conversation model overrides and for resolving a thread session
 * back to its base session).
 *
 * Feishu encodes topics inside the id itself (`oc_x:topic:t1`), so this returns
 * no separate `threadId`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeishuParentConversationCandidates = resolveFeishuParentConversationCandidates;
exports.resolveFeishuSessionConversation = resolveFeishuSessionConversation;
const conversation_id_1 = require("./conversation-id.js");
/**
 * Ordered narrowest → broadest: a topic+sender session falls back to the topic
 * session first, then the bare chat.
 */
function resolveFeishuParentConversationCandidates(rawId) {
    const parsed = (0, conversation_id_1.parseFeishuConversationId)({ conversationId: rawId });
    if (!parsed) {
        return [];
    }
    switch (parsed.scope) {
        case 'group_topic_sender':
            return [
                (0, conversation_id_1.buildFeishuConversationId)({
                    chatId: parsed.chatId,
                    scope: 'group_topic',
                    topicId: parsed.topicId,
                }),
                parsed.chatId,
            ];
        case 'group_topic':
        case 'group_sender':
            return [parsed.chatId];
        default:
            return [];
    }
}
/** Canonical Feishu session conversation for a raw id. */
function resolveFeishuSessionConversation(params) {
    const parsed = (0, conversation_id_1.parseFeishuConversationId)({ conversationId: params.rawId });
    if (!parsed) {
        return null;
    }
    return {
        id: parsed.canonicalConversationId,
        baseConversationId: parsed.chatId,
        // Always present (possibly empty) so core treats the candidates as
        // explicit and skips its legacy resolveParentConversationCandidates path.
        parentConversationCandidates: resolveFeishuParentConversationCandidates(parsed.canonicalConversationId),
    };
}
