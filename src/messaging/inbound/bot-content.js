"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Reply-routing decisions for the Feishu dispatch path.
 *
 * In bot-to-bot group scenarios, Feishu will pull thread-style replies into
 * a hidden "topic view" that group members cannot see (#32980). The peer bot
 * keeps receiving messages but humans in the chat see nothing — a silent
 * failure mode that turns bot↔bot chat into a black hole.
 *
 * This module centralizes the three signals that decide where a reply lands:
 *   1. isGroup            — DMs never have the topic-view trap
 *   2. senderIsBot        — only bot→bot triggers it
 *   3. dc.isThread        — inbound was a thread reply (also inferred from
 *                            root_id in topic groups when threadSession=true)
 *
 * Output: a routing object consumed by every outbound call site (main
 * dispatcher + i18n command card + i18n command text fallback), so the
 * three call sites never drift out of sync again.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBotPeerForMention = resolveBotPeerForMention;
exports.resolveFeishuGroupSession = resolveFeishuGroupSession;
exports.resolveFeishuReplyRouting = resolveFeishuReplyRouting;
const chat_info_cache_1 = require("../../core/chat-info-cache.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const conversation_id_1 = require("../../core/conversation-id.js");
const log = (0, lark_logger_1.larkLogger)('inbound/bot-content');
/** Trim a value to a non-empty string, otherwise `undefined`. */
function normalizeText(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
}
/**
 * Decide which peer (if any) an outbound reply must be guaranteed to
 * @-mention, so the deterministic `ensureMention` backstop can wake them up.
 *
 * Deliberately INDEPENDENT of `suppressForBotPeer` (which only governs
 * thread-vs-main routing): the addressee must be resolvable even on a
 * human-orchestrated kickoff, where the triggering sender is a person but the
 * conversation is meant to continue between bots.
 *
 *   1. Bot sender  → @ the sender back, continuing the exchange.
 *   2. Otherwise (e.g. a human kicking off a bot debate) → if the inbound
 *      message @-mentions exactly ONE party other than ourselves, treat that
 *      party as the designated peer. Zero / multiple non-self mentions are
 *      ambiguous, so we add no forced @ (avoids spamming unrelated members).
 *
 * Group-only: bot-at-bot @ delivery semantics don't apply to DMs.
 */
function resolveBotPeerForMention(params) {
    if (!params.isGroup)
        return undefined;
    // 1. Bot sender → keep the ping-pong going by @-ing them back.
    if (params.senderIsBot && params.senderId) {
        return { peerOpenId: params.senderId, peerName: params.senderName ?? params.senderId };
    }
    // 2. Human-orchestrated kickoff → the single non-self @-mentioned party.
    const seen = new Set();
    const others = [];
    for (const m of params.mentions) {
        if (!m.openId || m.isBot || m.openId === params.botOpenId)
            continue;
        if (seen.has(m.openId))
            continue;
        seen.add(m.openId);
        others.push(m);
    }
    if (others.length === 1) {
        return { peerOpenId: others[0].openId, peerName: others[0].name || others[0].openId };
    }
    return undefined;
}
/**
 * Resolve reply routing for the current dispatch, performing two tasks:
 *
 *  1. **Topic-group thread inference (may mutate `dc`).** In topic groups
 *     (chat_mode=topic), reply events may carry `root_id` without
 *     `thread_id`. When `threadSession` is enabled and the chat is
 *     thread-capable, treat `root_id` as a synthetic `threadId` so replies
 *     stay inside the topic instead of creating a new top-level message.
 *     This step mutates `dc.isThread` and `dc.ctx.threadId` so subsequent
 *     code (session-key resolution, sentinel scoping, history scoping)
 *     observes the same routing decision.
 *
 *  2. **Reply routing decision (pure).** Computes `replyInThread` and
 *     `suppressForBotPeer` from the post-inference state. In bot→bot group
 *     chats `replyInThread` is forced to `false` regardless of the inbound
 *     shape, preventing the topic-view trap.
 */
async function resolveFeishuReplyRouting(dc, opts = {}) {
    // Step 1: topic-group thread inference (async + side effects on dc)
    if (!dc.isThread &&
        dc.isGroup &&
        dc.ctx.rootId &&
        dc.account.config?.threadSession === true) {
        const threadCapable = await (0, chat_info_cache_1.isThreadCapableGroup)({
            cfg: dc.accountScopedCfg,
            chatId: dc.ctx.chatId,
            accountId: dc.account.accountId,
        });
        if (threadCapable) {
            log.info(`inferred thread from root_id=${dc.ctx.rootId} in topic group ${dc.ctx.chatId}`);
            dc.isThread = true;
            dc.ctx = { ...dc.ctx, threadId: dc.ctx.rootId };
        }
    }
    // Step 2: bot-peer suppression decision (pure read of dc state).
    //
    // We force a bot→bot reply out of the thread only when it would otherwise
    // snowball an *auto-detected* threadReply into a hidden topic view (#32980).
    // Two escape hatches keep parity with openclaw core (PR #89783):
    //   - isTopicSession: a deliberate topic session (threadSession enabled +
    //     inbound is in a thread) is human-visible by design — keep it threaded.
    //   - replyInThread config: operators can opt in per-group/account.
    const isTopicSession = dc.isThread && dc.account.config?.threadSession === true;
    const configReplyInThread = opts.replyInThreadConfig === true;
    const suppressForBotPeer = dc.isGroup && !!dc.ctx.senderIsBot && !isTopicSession && !configReplyInThread;
    const replyInThread = !suppressForBotPeer && dc.isThread;
    const threadId = replyInThread ? dc.ctx.threadId : undefined;
    return { replyInThread, threadId, suppressForBotPeer };
}
/**
 * Resolve the inbound group *session identity* from the configured
 * `groupSessionScope` (or the legacy `topicSessionMode`).
 *
 * Ported from @openclaw/feishu `src/bot-content.ts` (openclaw main 2f620b9).
 *
 * Without this, `groupSessionScope` was an inbound no-op: every message in a
 * group resolved to the same `peer.id = chatId`, so per-sender / per-topic
 * scoping only ever applied outbound. The returned `peerId` is the conversation
 * id fed to `resolveAgentRoute` (and used as the group history key), so a
 * `group_sender` group gives each speaker their own session and a
 * `group_topic` group gives each topic its own.
 *
 * `parentPeer` is set for topic scopes so core can fall back from the topic
 * session to the whole-chat session (per-conversation model overrides,
 * binding resolution).
 *
 * `chatType === 'topic_group'` is defensive: the raw Feishu `chat_type` is
 * `p2p`/`group`, so in practice the `rootId`/`threadId` fallbacks drive the
 * topic id — matching the official behaviour.
 */
function resolveFeishuGroupSession(params) {
    const { chatId, senderOpenId, messageId, rootId, threadId, chatType, groupConfig, feishuCfg } = params;
    const normalizedThreadId = normalizeText(threadId);
    const normalizedRootId = normalizeText(rootId);
    const threadReply = Boolean(normalizedThreadId || normalizedRootId);
    const replyInThread = (groupConfig?.replyInThread ?? feishuCfg?.replyInThread ?? 'disabled') === 'enabled' ||
        threadReply;
    const groupSessionScope = (0, conversation_id_1.resolveConfiguredFeishuGroupSessionScope)({
        groupConfig,
        feishuCfg,
    });
    const normalizedTopicGroupThreadId = chatType === 'topic_group' ? (normalizedThreadId ?? normalizedRootId) : undefined;
    const topicScope = groupSessionScope === 'group_topic' || groupSessionScope === 'group_topic_sender'
        ? (normalizedTopicGroupThreadId ??
            normalizedRootId ??
            normalizedThreadId ??
            (replyInThread ? messageId : null))
        : null;
    let peerId;
    switch (groupSessionScope) {
        case 'group_sender':
            peerId = (0, conversation_id_1.buildFeishuConversationId)({
                chatId,
                scope: 'group_sender',
                senderOpenId,
            });
            break;
        case 'group_topic':
            peerId = topicScope
                ? (0, conversation_id_1.buildFeishuConversationId)({
                    chatId,
                    scope: 'group_topic',
                    topicId: topicScope,
                })
                : chatId;
            break;
        case 'group_topic_sender':
            peerId = topicScope
                ? (0, conversation_id_1.buildFeishuConversationId)({
                    chatId,
                    scope: 'group_topic_sender',
                    topicId: topicScope,
                    senderOpenId,
                })
                : (0, conversation_id_1.buildFeishuConversationId)({
                    chatId,
                    scope: 'group_sender',
                    senderOpenId,
                });
            break;
        default:
            peerId = chatId;
            break;
    }
    return {
        peerId,
        parentPeer: topicScope && (groupSessionScope === 'group_topic' || groupSessionScope === 'group_topic_sender')
            ? { kind: 'group', id: chatId }
            : null,
        groupSessionScope,
        replyInThread,
        threadReply,
    };
}
