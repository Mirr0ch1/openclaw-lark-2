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
import type { MentionInfo } from '../types';
import type { DispatchContext } from './dispatch-context';
/** The peer a reply must explicitly @-mention so it actually reaches them. */
export interface BotPeerTarget {
    peerOpenId: string;
    peerName: string;
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
export declare function resolveBotPeerForMention(params: {
    isGroup: boolean;
    senderIsBot?: boolean;
    senderId?: string;
    senderName?: string;
    mentions: MentionInfo[];
    botOpenId?: string;
}): BotPeerTarget | undefined;
/** The four group session scoping modes (most specific last). */
export type FeishuGroupSessionScope = 'group' | 'group_sender' | 'group_topic' | 'group_topic_sender';
/** The resolved inbound group session identity. */
export interface ResolvedFeishuGroupSession {
    /** Conversation id fed to `resolveAgentRoute` and used as the group history key. */
    peerId: string;
    /** Whole-chat peer to fall back to for topic-scoped sessions; null otherwise. */
    parentPeer: {
        kind: 'group';
        id: string;
    } | null;
    groupSessionScope: FeishuGroupSessionScope;
    replyInThread: boolean;
    threadReply: boolean;
}
/**
 * Resolve the inbound group session identity from the configured
 * `groupSessionScope` (or legacy `topicSessionMode`).
 *
 * Ported from @openclaw/feishu `src/bot-content.ts` (openclaw main 2f620b9).
 * Makes `groupSessionScope` actually scope inbound sessions (per-sender /
 * per-topic) instead of collapsing every group message onto `chatId`.
 */
export declare function resolveFeishuGroupSession(params: {
    chatId: string;
    senderOpenId: string;
    messageId: string;
    rootId?: string;
    threadId?: string;
    chatType?: string;
    groupConfig?: {
        groupSessionScope?: FeishuGroupSessionScope;
        topicSessionMode?: 'enabled' | 'disabled';
        replyInThread?: 'enabled' | 'disabled';
    };
    feishuCfg?: {
        groupSessionScope?: FeishuGroupSessionScope;
        topicSessionMode?: 'enabled' | 'disabled';
        replyInThread?: 'enabled' | 'disabled';
    };
}): ResolvedFeishuGroupSession;
export interface FeishuReplyRouting {
    /** Whether to send the reply as a thread-scoped message. */
    replyInThread: boolean;
    /** Effective thread_id when replying in-thread; undefined otherwise. */
    threadId: string | undefined;
    /** True when the peer is a bot in a group chat: suppress thread-mode reply
     *  so the message lands in the main chat (avoiding the hidden topic view,
     *  #32980). Consumers may also use this signal for additional bot-peer-
     *  specific behavior (e.g. ensureMention in outbound-mention). */
    suppressForBotPeer: boolean;
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
export declare function resolveFeishuReplyRouting(dc: DispatchContext, opts?: {
    replyInThreadConfig?: boolean;
}): Promise<FeishuReplyRouting>;
