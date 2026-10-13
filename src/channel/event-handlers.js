"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Event handlers for the Feishu WebSocket monitor.
 *
 * Extracted from monitor.ts to improve testability and reduce
 * function size. Each handler receives a MonitorContext with all
 * dependencies needed to process the event.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMessageEvent = handleMessageEvent;
exports.handleReactionEvent = handleReactionEvent;
exports.handleBotMembershipEvent = handleBotMembershipEvent;
exports.handleVcMeetingInvitedEvent = handleVcMeetingInvitedEvent;
exports.handleCommentEvent = handleCommentEvent;
exports.handleCardActionEvent = handleCardActionEvent;
const crypto = __importStar(require("node:crypto"));
const handler_1 = require("../messaging/inbound/handler.js");
const reaction_handler_1 = require("../messaging/inbound/reaction-handler.js");
const comment_handler_1 = require("../messaging/inbound/comment-handler.js");
const vc_meeting_invited_handler_1 = require("../messaging/inbound/vc-meeting-invited-handler.js");
const vc_sender_1 = require("../messaging/inbound/vc-sender.js");
const comment_context_1 = require("../messaging/inbound/comment-context.js");
const dedup_1 = require("../messaging/inbound/dedup.js");
const dedupe_key_1 = require("../messaging/inbound/dedupe-key.js");
const lark_ticket_1 = require("../core/lark-ticket.js");
const lark_logger_1 = require("../core/lark-logger.js");
const auto_auth_1 = require("../tools/auto-auth.js");
const ask_user_gateway_card_1 = require("../card/ask-user-gateway-card.js");
const synthetic_message_1 = require("../messaging/inbound/synthetic-message.js");
const chat_info_cache_1 = require("../core/chat-info-cache.js");
const message_lookup_1 = require("../messaging/shared/message-lookup.js");
const chat_queue_1 = require("./chat-queue.js");
const abort_detect_1 = require("./abort-detect.js");
const interactive_dispatch_1 = require("./interactive-dispatch.js");
const elog = (0, lark_logger_1.larkLogger)('channel/event-handlers');
// ---------------------------------------------------------------------------
// Event ownership validation
// ---------------------------------------------------------------------------
/**
 * Verify that the event's app_id matches the current account.
 *
 * Lark SDK EventDispatcher flattens the v2 envelope header (which
 * contains `app_id`) into the handler `data` object, so `app_id` is
 * available directly on `data`.
 *
 * Returns `false` (discard event) when the app_id does not match.
 */
function isEventOwnershipValid(ctx, data) {
    const expectedAppId = ctx.lark.account.appId;
    if (!expectedAppId)
        return true; // appId not configured — skip check
    const eventAppId = data.app_id;
    if (eventAppId == null)
        return true; // SDK did not provide app_id — defensive skip
    if (eventAppId !== expectedAppId) {
        elog.warn('event app_id mismatch, discarding', {
            accountId: ctx.accountId,
            expected: expectedAppId,
            received: String(eventAppId),
        });
        return false;
    }
    return true;
}
// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
async function handleMessageEvent(ctx, data) {
    if (!isEventOwnershipValid(ctx, data))
        return;
    const { accountId, log, error } = ctx;
    try {
        const event = data;
        // Self-echo hard filter — drop messages authored by this very bot before
        // dedup and enqueue. Prevents self-reply loops; the primary guardrail
        // against bot-to-bot ping-pong.
        //
        // NOTE: if botOpenId is not yet populated (startup race before probe
        // resolves), this filter is skipped. The downstream bot-sender gate
        // (checkBotSenderGate) acts as fallback — bot messages default to
        // `allowBots='mentions'`, so in groups they require an explicit @-mention
        // of this bot to pass; DMs are pass-through under the default.
        const senderOpenId = event.sender?.sender_id?.open_id;
        const botOpenId = ctx.lark.botOpenId;
        if (botOpenId && senderOpenId && senderOpenId === botOpenId) {
            log(`feishu[${accountId}]: drop self-echo message ${event.message?.message_id ?? 'unknown'}`);
            return;
        }
        const msgId = event.message?.message_id ?? 'unknown';
        const chatId = event.message?.chat_id ?? '';
        // In topic groups, reply events carry root_id but not thread_id.
        // Use root_id as fallback so different topics get separate queue keys
        // and can be processed in parallel.
        const threadId = event.message?.thread_id || event.message?.root_id || undefined;
        // Dedup — skip duplicate messages (e.g. from WebSocket reconnects).
        // For text/post we key on a retry-stable identity (sender+chat+
        // create_time+content) so a redelivery with a fresh message_id is
        // still caught (#46778); everything else falls back to message_id.
        const dedupeKey = (0, dedupe_key_1.resolveFeishuMessageDedupeKey)(event) ?? msgId;
        if (!ctx.messageDedup.tryRecord(dedupeKey, accountId)) {
            log(`feishu[${accountId}]: duplicate message ${msgId}, skipping`);
            return;
        }
        // Expiry — discard stale messages from reconnect replay.
        if ((0, dedup_1.isMessageExpired)(event.message?.create_time)) {
            log(`feishu[${accountId}]: message ${msgId} expired, discarding`);
            return;
        }
        // ---- Abort fast-path ----
        // If the message looks like an abort trigger and there is an active
        // reply dispatcher for this chat, fire abortCard() immediately
        // (before the message enters the serial queue) so the streaming
        // card is terminated without waiting for the current task.
        const abortText = (0, abort_detect_1.extractRawTextFromEvent)(event);
        if (abortText && (0, abort_detect_1.isLikelyAbortText)(abortText)) {
            const queueKey = (0, chat_queue_1.buildQueueKey)(accountId, chatId, threadId);
            if ((0, chat_queue_1.hasActiveTask)(queueKey)) {
                const active = (0, chat_queue_1.getActiveDispatcher)(queueKey);
                if (active) {
                    log(`feishu[${accountId}]: abort fast-path triggered for chat ${chatId} (text="${abortText}")`);
                    active.abortController?.abort();
                    active.abortCard().catch((err) => {
                        error(`feishu[${accountId}]: abort fast-path abortCard failed: ${String(err)}`);
                    });
                }
            }
        }
        const { status } = (0, chat_queue_1.enqueueFeishuChatTask)({
            accountId,
            chatId,
            threadId,
            onTaskTimeout: (key, timeoutMs) => {
                log(`feishu[${accountId}]: per-chat task exceeded ${timeoutMs}ms cap (key=${key}); evicting from queue so later same-key messages can proceed (#70133)`);
            },
            task: async () => {
                try {
                    await (0, lark_ticket_1.withTicket)({
                        messageId: msgId,
                        chatId,
                        accountId,
                        startTime: Date.now(),
                        senderOpenId: event.sender?.sender_id?.open_id || '',
                        chatType: event.message?.chat_type || undefined,
                        threadId,
                    }, () => (0, handler_1.handleFeishuMessage)({
                        cfg: ctx.cfg,
                        event,
                        botOpenId: ctx.lark.botOpenId,
                        runtime: ctx.runtime,
                        chatHistories: ctx.chatHistories,
                        accountId,
                    }));
                }
                catch (err) {
                    error(`feishu[${accountId}]: error handling message: ${String(err)}`);
                }
            },
        });
        log(`feishu[${accountId}]: message ${msgId} in chat ${chatId}${threadId ? ` thread ${threadId}` : ''} — ${status}`);
    }
    catch (err) {
        error(`feishu[${accountId}]: error handling message: ${String(err)}`);
    }
}
// ---------------------------------------------------------------------------
// Reaction handler
// ---------------------------------------------------------------------------
async function handleReactionEvent(ctx, data) {
    if (!isEventOwnershipValid(ctx, data))
        return;
    const { accountId, log, error } = ctx;
    try {
        const event = data;
        const msgId = event.message_id ?? 'unknown';
        log(`feishu[${accountId}]: reaction event on message ${msgId}`);
        // ---- Dedup: deterministic key based on message + emoji + operator ----
        const emojiType = event.reaction_type?.emoji_type ?? '';
        const operatorOpenId = event.user_id?.open_id ?? '';
        const dedupKey = `${msgId}:reaction:${emojiType}:${operatorOpenId}`;
        if (!ctx.messageDedup.tryRecord(dedupKey, accountId)) {
            log(`feishu[${accountId}]: duplicate reaction ${dedupKey}, skipping`);
            return;
        }
        // ---- Expiry: discard stale reaction events ----
        if ((0, dedup_1.isMessageExpired)(event.action_time)) {
            log(`feishu[${accountId}]: reaction on ${msgId} expired, discarding`);
            return;
        }
        // ---- Pre-resolve real chatId before enqueuing ----
        // The API call (3s timeout) runs outside the queue so it doesn't
        // block the serial chain, and is read-only so ordering is irrelevant.
        const preResolved = await (0, reaction_handler_1.resolveReactionContext)({
            cfg: ctx.cfg,
            event,
            botOpenId: ctx.lark.botOpenId,
            runtime: ctx.runtime,
            accountId,
        });
        if (!preResolved)
            return;
        // ---- Enqueue with the real chatId (matches normal message queue key) ----
        const { status } = (0, chat_queue_1.enqueueFeishuChatTask)({
            accountId,
            chatId: preResolved.chatId,
            threadId: preResolved.threadId,
            onTaskTimeout: (key, timeoutMs) => {
                log(`feishu[${accountId}]: per-chat task exceeded ${timeoutMs}ms cap (key=${key}); evicting from queue so later same-key messages can proceed (#70133)`);
            },
            task: async () => {
                try {
                    await (0, lark_ticket_1.withTicket)({
                        messageId: msgId,
                        chatId: preResolved.chatId,
                        accountId,
                        startTime: Date.now(),
                        senderOpenId: operatorOpenId,
                        chatType: preResolved.chatType,
                        threadId: preResolved.threadId,
                    }, () => (0, reaction_handler_1.handleFeishuReaction)({
                        cfg: ctx.cfg,
                        event,
                        botOpenId: ctx.lark.botOpenId,
                        runtime: ctx.runtime,
                        chatHistories: ctx.chatHistories,
                        accountId,
                        preResolved,
                    }));
                }
                catch (err) {
                    error(`feishu[${accountId}]: error handling reaction: ${String(err)}`);
                }
            },
        });
        log(`feishu[${accountId}]: reaction on ${msgId} (chatId=${preResolved.chatId}) — ${status}`);
    }
    catch (err) {
        error(`feishu[${accountId}]: error handling reaction event: ${String(err)}`);
    }
}
// ---------------------------------------------------------------------------
// Bot membership handler
// ---------------------------------------------------------------------------
async function handleBotMembershipEvent(ctx, data, action) {
    if (!isEventOwnershipValid(ctx, data))
        return;
    const { accountId, log, error } = ctx;
    try {
        const event = data;
        log(`feishu[${accountId}]: bot ${action} ${action === 'removed' ? 'from' : 'to'} chat ${event.chat_id}`);
    }
    catch (err) {
        error(`feishu[${accountId}]: error handling bot ${action} event: ${String(err)}`);
    }
}
// ---------------------------------------------------------------------------
// VC meeting invited handler
// ---------------------------------------------------------------------------
async function handleVcMeetingInvitedEvent(ctx, data) {
    if (!isEventOwnershipValid(ctx, data))
        return;
    const { accountId, log, error } = ctx;
    try {
        const event = data;
        const meetingNo = event.meeting?.meeting_no?.trim() ?? '';
        const eventId = event.event_id?.trim() ?? '';
        // Resolve the inviter identity through the shared helper so the
        // diagnostics log and the dispatch handler always agree on the
        // same sender semantics.
        const sender = (0, vc_sender_1.resolveVcSender)(event);
        const senderId = sender.senderId;
        const invitedBotOpenId = event.bot?.id?.open_id?.trim() ?? '';
        // VC invited origin/ownership diagnostics:
        // - This handler is only reachable from the WebSocket monitor path.
        // - We still log app_id/bot_open_id so operators can confirm the event
        //   is delivered to the expected bot/account, and see which required
        //   fields are missing when we skip.
        const expectedAppId = ctx.lark.account.appId ?? '';
        const eventAppId = event.app_id?.trim() ?? '';
        log(`feishu[${accountId}]: vc invited event received (ingress=websocket)` +
            `${eventId ? ` event_id=${eventId}` : ''}` +
            `${eventAppId ? ` app_id=${eventAppId}` : ' app_id=<missing>'}` +
            `${expectedAppId ? ` expected_app_id=${expectedAppId}` : ''}` +
            `${invitedBotOpenId ? ` bot_open_id=${invitedBotOpenId}` : ' bot_open_id=<missing>'}` +
            `${ctx.lark.botOpenId ? ` expected_bot_open_id=${ctx.lark.botOpenId}` : ''}` +
            `${event.invite_time ? ` invite_time=${event.invite_time}` : ''}` +
            ` meeting_no_present=${meetingNo ? 'true' : 'false'}` +
            ` sender_present=${senderId ? 'true' : 'false'}` +
            ` sender_from=${sender.fromFallback}`);
        if (!meetingNo) {
            log(`feishu[${accountId}]: vc invited event missing meeting_no, skipping`);
            return;
        }
        if (!senderId) {
            log(`feishu[${accountId}]: vc invited event missing inviter identity, skipping`);
            return;
        }
        if (ctx.lark.botOpenId && invitedBotOpenId && invitedBotOpenId !== ctx.lark.botOpenId) {
            log(`feishu[${accountId}]: vc invited event for another bot, expected=${ctx.lark.botOpenId}, got=${invitedBotOpenId}, skipping`);
            return;
        }
        // Prefer event_id when the SDK exposes it: historical raw payload logs
        // show WebSocket reconnect replays reuse the same event_id, while a real
        // second invitation yields a new event_id even for the same meeting/bot.
        // Fallback to (meeting_no, bot) only when event_id is absent so older
        // payload shapes still remain deduplicated.
        const dedupBotKey = ctx.lark.botOpenId ?? invitedBotOpenId ?? 'no-bot';
        const dedupKey = eventId ? `vc-invited:by-event:${eventId}` : `vc-invited:by-meeting:${meetingNo}:${dedupBotKey}`;
        if (!ctx.messageDedup.tryRecord(dedupKey, accountId)) {
            log(`feishu[${accountId}]: duplicate vc invited event detected, skipping`);
            return;
        }
        log(`feishu[${accountId}]: vc invited event accepted for synthetic dispatch`);
        await (0, vc_meeting_invited_handler_1.handleFeishuVcMeetingInvited)({
            cfg: ctx.cfg,
            event,
            runtime: ctx.runtime,
            chatHistories: ctx.chatHistories,
            accountId,
        });
    }
    catch (err) {
        error(`feishu[${accountId}]: error handling vc invited event: ${String(err)}`);
    }
}
// ---------------------------------------------------------------------------
// Drive comment handler
// ---------------------------------------------------------------------------
async function handleCommentEvent(ctx, data) {
    if (!isEventOwnershipValid(ctx, data))
        return;
    const { accountId, log, error } = ctx;
    try {
        const parsed = (0, comment_context_1.parseFeishuDriveCommentNoticeEventPayload)(data);
        if (!parsed) {
            log(`feishu[${accountId}]: invalid comment event payload, skipping`);
            return;
        }
        const commentId = parsed.comment_id ?? '';
        const replyId = parsed.reply_id ?? '';
        // Parser has normalized notice_meta fields into canonical top-level fields
        const _senderOpenId = parsed.user_id?.open_id ?? '';
        const isMentioned = parsed.is_mention ?? false;
        const eventTimestamp = parsed.action_time;
        log(`feishu[${accountId}]: drive comment event: ` +
            `type=${parsed.file_type}, comment=${commentId}` +
            `${replyId ? `, reply=${replyId}` : ''}` +
            `${isMentioned ? ', @bot' : ''}`);
        // Dedup: build a deterministic key from the comment/reply IDs
        const dedupKey = replyId ? `comment:${commentId}:reply:${replyId}` : `comment:${commentId}`;
        if (!ctx.messageDedup.tryRecord(dedupKey, accountId)) {
            log(`feishu[${accountId}]: duplicate comment event ${dedupKey}, skipping`);
            return;
        }
        // Expiry check
        if ((0, dedup_1.isMessageExpired)(eventTimestamp)) {
            log(`feishu[${accountId}]: comment event expired, discarding`);
            return;
        }
        // Dispatch the comment event (no queue serialization needed for comment threads)
        await (0, comment_handler_1.handleFeishuCommentEvent)({
            cfg: ctx.cfg,
            event: parsed,
            botOpenId: ctx.lark.botOpenId,
            runtime: ctx.runtime,
            chatHistories: ctx.chatHistories,
            accountId,
        });
    }
    catch (err) {
        error(`feishu[${accountId}]: error handling comment event: ${String(err)}`);
    }
}
/**
 * Generic "button click = inject a user message" mechanism.
 *
 * When a card button's `value` is `{ action: "inject_prompt", prompt: "<text>" }`,
 * clicking it dispatches `<text>` as a synthetic user message (via the standard
 * inbound pipeline, `replyToMessageId` set to the card's own message so the agent
 * replies in the same conversation) and returns a toast receipt. This lets any
 * card offer functional buttons — click a button, the corresponding request runs,
 * no typing needed — without registering a business plugin handler.
 *
 * Returns the toast receipt when the event is an inject_prompt action, or
 * `undefined` so the caller falls through to the other card handlers.
 *
 * Security / correctness (mirrors reaction-handler, which faces the same
 * "card-ish event carries no chat_type/thread_id" problem):
 *  - Chat type is resolved from the cached chat-info helper and the dispatch
 *    fails closed if it can't be determined, so a group card is never
 *    mis-routed as a p2p direct session.
 *  - The synthetic message goes through the real access-control gate
 *    (`cardActionGate`): the click satisfies the mention requirement, but
 *    group/DM admission and sender allowlists are still enforced.
 *  - The synthetic message id is unique per click (event_id / token / uuid), so
 *    inbound MessageSid dedup does not silently drop a second button click.
 *  - Only a real `operator.open_id` is used as the sender identity; a Schema-2
 *    `user_id` is never smuggled into an `open_id` field (fail closed instead).
 *
 * Note: `card.action.trigger` is a synchronous request/response — the handler
 * MUST return a card receipt (here a toast). Returning `undefined` makes the SDK
 * fall back to a card update it cannot resolve, which Feishu rejects with
 * `99992354 Invalid ids:[card]`. So we dispatch the synthetic message
 * asynchronously (`setImmediate`) and return the toast synchronously.
 */
function handleInjectPromptAction(ctx, data) {
    const ev = data;
    const val = ev.action?.value;
    if (!val || val.action !== 'inject_prompt' || typeof val.prompt !== 'string' || !val.prompt.trim()) {
        return undefined;
    }
    // Use only a real open_id as the sender identity. A Schema-2 callback may carry
    // only operator.user_id; that is a different namespace and must not be written
    // into an open_id field (would corrupt session routing, sender allowlists,
    // user-token lookup, and owner checks). Fail closed until user_id→open_id
    // conversion is supported.
    const senderOpenId = ev.operator?.open_id?.trim();
    const chatId = ev.open_chat_id ?? ev.context?.open_chat_id;
    const cardMsgId = ev.open_message_id ?? ev.context?.open_message_id;
    if (!senderOpenId || !chatId) {
        elog.warn('inject_prompt: missing operator open_id or chatId, ignoring');
        return { toast: { type: 'error', content: '无法处理该操作' } };
    }
    const prompt = val.prompt;
    // Unique per click so inbound dedup (by MessageSid, ~20min) does not drop a
    // second click on a different button of the same card. Prefer the callback's
    // unique event_id; fall back to token, then a random uuid.
    const syntheticMessageId = ev.event_id?.trim() || ev.token?.trim() || crypto.randomUUID();
    // Dispatch asynchronously so the synchronous toast receipt is not blocked.
    // The card trigger carries no chat_type or thread_id, so resolve both here.
    setImmediate(async () => {
        try {
            // Resolve the real chat type; fail closed if it can't be determined
            // (do NOT assume p2p — that would mis-route a group card).
            const info = await (0, chat_info_cache_1.getChatInfo)({ cfg: ctx.cfg, chatId, accountId: ctx.accountId });
            if (!info) {
                elog.warn(`inject_prompt: could not resolve chat type for ${chatId}, skipping dispatch`);
                return;
            }
            const chatType = info.chatMode === 'group' || info.chatMode === 'topic' ? 'group' : 'p2p';
            // Recover the thread id from the card's own message (the trigger has none)
            // so thread session isolation is preserved.
            let threadId;
            if (cardMsgId) {
                const msg = await (0, message_lookup_1.getMessageFeishu)({ cfg: ctx.cfg, messageId: cardMsgId, accountId: ctx.accountId }).catch(() => null);
                threadId = msg?.threadId;
            }
            await (0, synthetic_message_1.dispatchSyntheticTextMessage)({
                cfg: ctx.cfg,
                accountId: ctx.accountId,
                chatId,
                senderOpenId,
                text: prompt,
                syntheticMessageId,
                replyToMessageId: cardMsgId ?? '',
                chatType,
                threadId,
                forceMention: false,
                cardActionGate: true,
                runtime: ctx.runtime,
            });
        }
        catch (e) {
            elog.warn(`inject_prompt dispatch failed: ${e}`);
        }
    });
    return { toast: { type: 'info', content: '收到，正在为你处理…' } };
}
async function handleCardActionEvent(ctx, data) {
    try {
        // inject_prompt：通用「按钮点击 = 注入一条用户消息」机制（渠道内建，优先拦截）。
        const injectResult = handleInjectPromptAction(ctx, data);
        if (injectResult !== undefined)
            return injectResult;
        // Gateway ask_user：内置 ask_user 工具的选项按钮卡片
        const askGatewayResult = await (0, ask_user_gateway_card_1.handleAskUserQuestionAction)(data, ctx.cfg, ctx.accountId);
        if (askGatewayResult !== undefined)
            return askGatewayResult;
        // auto-auth：授权/权限引导相关卡片交互（宿主内建能力优先）
        const authResult = await (0, auto_auth_1.handleCardAction)(data, ctx.cfg, ctx.accountId);
        if (authResult !== undefined)
            return authResult;
        // 业务自定义卡片交互：使用 SDK 标准 interactive dispatch 管道转发给业务插件。
        return await (0, interactive_dispatch_1.dispatchFeishuPluginInteractiveHandler)({ cfg: ctx.cfg, accountId: ctx.accountId, data });
    }
    catch (err) {
        elog.warn(`card.action.trigger handler error: ${err}`);
    }
}
