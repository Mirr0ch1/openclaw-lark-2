"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu conversation-id grammar.
 *
 * Ported from @openclaw/feishu `src/conversation-id.ts` (openclaw main 2f620b9).
 *
 * A conversation id encodes an optional group *scope* so a group chat can host
 * several independent sessions:
 *
 *   <chatId>
 *   <chatId>:topic:<topicId>
 *   <chatId>:sender:<senderOpenId>
 *   <chatId>:topic:<topicId>:sender:<senderOpenId>
 *
 * The id is what gets bound to a session by the thread-binding manager, so the
 * build/parse pair must stay exact inverses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConfiguredFeishuGroupSessionScope = resolveConfiguredFeishuGroupSessionScope;
exports.buildFeishuConversationId = buildFeishuConversationId;
exports.parseFeishuTargetId = parseFeishuTargetId;
exports.parseFeishuDirectConversationId = parseFeishuDirectConversationId;
exports.parseFeishuConversationId = parseFeishuConversationId;
exports.buildFeishuModelOverrideParentCandidates = buildFeishuModelOverrideParentCandidates;
const targets_1 = require("./targets.js");
// ---------------------------------------------------------------------------
// Local string helpers (the upstream module uses string-coerce-runtime)
// ---------------------------------------------------------------------------
/** Trim a value to a non-empty string, otherwise `undefined`. */
function normalizeText(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
}
/** Normalize to a lowercased, trimmed string (empty string when not a string). */
function normalizeLowercaseStringOrEmpty(raw) {
    return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}
/** Strip a leading `feishu:` / `lark:` provider tag. */
function stripFeishuProviderPrefix(raw) {
    return raw.replace(/^(feishu|lark):/i, '').trim();
}
// ---------------------------------------------------------------------------
// Scope grammar
// ---------------------------------------------------------------------------
/**
 * Ordered most-specific-first: `group_topic_sender` must be matched before
 * `group_topic` / `group_sender`, otherwise `:sender:` would be swallowed into
 * the topic id.
 */
const SCOPED_CONVERSATION_PATTERNS = [
    ['group_topic_sender', /^(?<chatId>.+):topic:(?<topicId>[^:]+):sender:(?<senderOpenId>[^:]+)$/i],
    ['group_topic', /^(?<chatId>.+):topic:(?<topicId>[^:]+)$/i],
    ['group_sender', /^(?<chatId>.+):sender:(?<senderOpenId>[^:]+)$/i],
];
/**
 * Resolve the effective group session scope. Account/group config wins over the
 * legacy `topicSessionMode` boolean, which only ever enabled topic scoping.
 */
function resolveConfiguredFeishuGroupSessionScope(params) {
    const legacyTopicSessionMode = params.groupConfig?.topicSessionMode ?? params.feishuCfg?.topicSessionMode ?? 'disabled';
    return (params.groupConfig?.groupSessionScope ??
        params.feishuCfg?.groupSessionScope ??
        (legacyTopicSessionMode === 'enabled' ? 'group_topic' : 'group'));
}
/** Build a conversation id from its parts (inverse of {@link parseFeishuConversationId}). */
function buildFeishuConversationId(params) {
    const chatId = normalizeText(params.chatId) ?? 'unknown';
    const senderOpenId = normalizeText(params.senderOpenId);
    const topicId = normalizeText(params.topicId);
    let conversationId = chatId;
    if (topicId && (params.scope === 'group_topic' || params.scope === 'group_topic_sender')) {
        conversationId += `:topic:${topicId}`;
    }
    if (senderOpenId && (params.scope === 'group_sender' || params.scope === 'group_topic_sender')) {
        conversationId += `:sender:${senderOpenId}`;
    }
    return conversationId;
}
/** Normalise an arbitrary target to a bare Feishu id, if it is one. */
function parseFeishuTargetId(raw) {
    const target = normalizeText(raw);
    if (!target)
        return undefined;
    return (0, targets_1.normalizeFeishuTarget)(target) || undefined;
}
/** Extract the open id when the conversation id names a DM (`user:` / `dm:` / `open_id:`). */
function parseFeishuDirectConversationId(raw) {
    const target = normalizeText(raw);
    if (!target)
        return undefined;
    const withoutProvider = stripFeishuProviderPrefix(target);
    if (!withoutProvider)
        return undefined;
    const lowered = normalizeLowercaseStringOrEmpty(withoutProvider);
    for (const prefix of ['user:', 'dm:', 'open_id:']) {
        if (lowered.startsWith(prefix))
            return normalizeText(withoutProvider.slice(prefix.length));
    }
    // Use the provider-stripped value: our `normalizeFeishuTarget` only strips
    // `feishu:` (not `lark:`), so passing the raw target would drop `lark:ou_…`.
    const id = parseFeishuTargetId(withoutProvider);
    if (!id)
        return undefined;
    if (id.startsWith('ou_') || id.startsWith('on_'))
        return id;
    return undefined;
}
/**
 * Parse a conversation id back into its parts.
 *
 * `parentConversationId` is the fallback shape used when the id is a bare topic
 * id (Feishu reports `root_id` separately from the chat), in which case the
 * chat id comes from the parent.
 */
function parseFeishuConversationId(params) {
    const conversationId = normalizeText(params.conversationId);
    const parentConversationId = normalizeText(params.parentConversationId);
    if (!conversationId)
        return null;
    for (const [scope, pattern] of SCOPED_CONVERSATION_PATTERNS) {
        const fields = conversationId.match(pattern)?.groups;
        if (!fields?.chatId)
            continue;
        const parsed = {
            scope,
            chatId: fields.chatId,
            ...(fields.topicId !== undefined ? { topicId: fields.topicId } : {}),
            ...(fields.senderOpenId !== undefined ? { senderOpenId: fields.senderOpenId } : {}),
        };
        return {
            canonicalConversationId: buildFeishuConversationId(parsed),
            ...parsed,
        };
    }
    if (parentConversationId) {
        return {
            canonicalConversationId: buildFeishuConversationId({
                chatId: parentConversationId,
                scope: 'group_topic',
                topicId: conversationId,
            }),
            chatId: parentConversationId,
            topicId: conversationId,
            scope: 'group_topic',
        };
    }
    return {
        canonicalConversationId: conversationId,
        chatId: conversationId,
        scope: 'group',
    };
}
/**
 * Candidate parent conversation ids to try when resolving a per-conversation
 * model override: the topic scope first, then the bare chat.
 */
function buildFeishuModelOverrideParentCandidates(parentConversationId) {
    const rawId = normalizeText(parentConversationId);
    if (!rawId)
        return [];
    const parsed = parseFeishuConversationId({ conversationId: rawId });
    const chatId = normalizeLowercaseStringOrEmpty(parsed?.chatId);
    if (!chatId || parsed?.scope === 'group')
        return [];
    if (parsed?.scope === 'group_topic_sender') {
        const topicId = normalizeLowercaseStringOrEmpty(parsed.topicId);
        return topicId ? [`${chatId}:topic:${topicId}`, chatId] : [];
    }
    return [chatId];
}
