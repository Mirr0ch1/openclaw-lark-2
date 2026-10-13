"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Message sending for the Lark/Feishu channel plugin.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessageFeishu = sendMessageFeishu;
exports.sendCardFeishu = sendCardFeishu;
exports.updateCardFeishu = updateCardFeishu;
exports.buildMarkdownCard = buildMarkdownCard;
exports.buildI18nMarkdownCard = buildI18nMarkdownCard;
exports.sendMarkdownCardFeishu = sendMarkdownCardFeishu;
exports.editMessageFeishu = editMessageFeishu;
exports.deleteMessageFeishu = deleteMessageFeishu;
const accounts_1 = require("../../core/accounts.js");
const lark_client_1 = require("../../core/lark-client.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const chat_queue_1 = require("../../channel/chat-queue.js");
const targets_1 = require("../../core/targets.js");
const message_unavailable_1 = require("../../core/message-unavailable.js");
const markdown_style_1 = require("../../card/markdown-style.js");
const mention_1 = require("../inbound/mention.js");
const sentinel_store_1 = require("../inbound/sentinel-store.js");
const normalize_mentions_1 = require("./normalize-mentions.js");
const outbound_mention_1 = require("./outbound-mention.js");
const bot_peer_context_1 = require("./bot-peer-context.js");
const send_rate_limit_1 = require("./send-rate-limit.js");
const sendLog = (0, lark_logger_1.larkLogger)('outbound/send');
/**
 * Runs the outbound text through mention normalization. Returns the
 * input unchanged on any failure so a parser bug never blocks send.
 * Sentinels collected during normalization are returned for the caller
 * to record after a successful send.
 */
async function normalizeFeishuOutboundText(cfg, to, text, accountId) {
    if (!text?.trim())
        return { text, sentinels: [], resolvedAccountId: accountId };
    try {
        const account = (0, accounts_1.getLarkAccount)(cfg, accountId ?? undefined);
        const ctx = {
            chatId: to,
            account,
            log: (...args) => sendLog.warn(args.map(String).join(' ')),
        };
        const r = await (0, normalize_mentions_1.normalizeOutboundMentions)(text, ctx);
        let outText = r.normalizedText;
        // Deterministic backstop on the real reply path: when this dispatch is
        // replying to a designated bot peer (set via runWithBotPeerContext in the
        // inbound dispatch), guarantee an @-mention so the peer actually receives
        // the message even if the model didn't write one. No-op when no peer is
        // in scope. De-duped across chunks: once the peer @ has appeared (whether
        // the model wrote it or we injected it), later chunks of the same reply
        // are left untouched so we don't @ on every chunk.
        const peer = (0, bot_peer_context_1.currentBotPeerContext)();
        if (peer && !peer.mentioned) {
            outText = (0, outbound_mention_1.ensureMention)(outText, peer.peerOpenId, peer.peerName);
            if (outText.includes(`user_id="${peer.peerOpenId}"`)) {
                peer.mentioned = true;
            }
        }
        return { text: outText, sentinels: r.sentinels, resolvedAccountId: account.accountId };
    }
    catch (err) {
        sendLog.warn(`normalizeOutboundMentions failed, using raw text: ${String(err)}`);
        return { text, sentinels: [], resolvedAccountId: accountId };
    }
}
function recordFeishuSendSentinels(resolvedAccountId, to, threadId, sentinels) {
    if (!resolvedAccountId || sentinels.length === 0)
        return;
    const threadKey = (0, chat_queue_1.threadScopedKey)(to, threadId);
    (0, sentinel_store_1.getSentinelStore)(resolvedAccountId).recordSentinels(threadKey, sentinels);
}
// ---------------------------------------------------------------------------
// sendMessageFeishu
// ---------------------------------------------------------------------------
/**
 * Send a text message (rendered as a Feishu "post" with markdown support)
 * to a chat or user.
 *
 * The message text is wrapped in Feishu's post format using the `md` tag
 * for rich rendering. If `replyToMessageId` is provided, the message is
 * sent as a threaded reply; otherwise it is sent as a new message using
 * the appropriate `receive_id_type`.
 *
 * Markdown tables and code blocks are sent as-is so Feishu renders them
 * natively in the post(`tag:md`); only `optimizeMarkdownStyle` is applied.
 *
 * @param params - See {@link SendFeishuMessageParams}.
 * @returns The send result containing the new message ID.
 */
async function sendMessageFeishu(params) {
    const { cfg, to, replyToMessageId, mentions, accountId, replyInThread, i18nTexts, threadId } = params;
    let { text } = params;
    // Mention normalization. Single-locale path rewrites `text`; the
    // i18nTexts path rewrites each locale below. Sentinels are recorded
    // after the send succeeds.
    let normalizationSentinels = [];
    let normalizationAccountId = accountId ?? undefined;
    if (!i18nTexts && text?.trim()) {
        const r = await normalizeFeishuOutboundText(cfg, to, text, accountId ?? undefined);
        text = r.text;
        normalizationSentinels = r.sentinels;
        normalizationAccountId = r.resolvedAccountId;
    }
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    // Build the post-format content envelope.
    let contentPayload;
    if (i18nTexts && Object.keys(i18nTexts).length > 0) {
        // Multi-locale post: build each locale's content independently.
        const postBody = {};
        for (const [locale, localeText] of Object.entries(i18nTexts)) {
            let processed = localeText;
            // Apply mention prefix if targets are provided.
            if (mentions && mentions.length > 0) {
                processed = (0, mention_1.buildMentionedMessage)(mentions, processed);
            }
            // Apply Markdown style optimization.
            processed = (0, markdown_style_1.optimizeMarkdownStyle)(processed, 1);
            postBody[locale] = {
                content: [[{ tag: 'md', text: processed }]],
            };
        }
        contentPayload = JSON.stringify(postBody);
    }
    else {
        // Single-locale (zh_cn) post: original behavior.
        let messageText = text;
        // Apply mention prefix if targets are provided.
        if (mentions && mentions.length > 0) {
            messageText = (0, mention_1.buildMentionedMessage)(mentions, messageText);
        }
        // Apply Markdown style optimization.
        messageText = (0, markdown_style_1.optimizeMarkdownStyle)(messageText, 1);
        contentPayload = JSON.stringify({
            zh_cn: {
                content: [[{ tag: 'md', text: messageText }]],
            },
        });
    }
    if (replyToMessageId) {
        // Send as a threaded reply.
        // 规范化 message_id，处理合成 ID（如 "om_xxx:auth-complete"）
        const normalizedId = (0, targets_1.normalizeMessageId)(replyToMessageId);
        const response = await (0, message_unavailable_1.runWithMessageUnavailableGuard)({
            messageId: normalizedId,
            operation: 'im.message.reply(post)',
            fn: () => (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.reply({
                path: {
                    message_id: normalizedId,
                },
                data: {
                    content: contentPayload,
                    msg_type: 'post',
                    reply_in_thread: replyInThread,
                },
            }), 'im.message.reply(post)'),
        });
        recordFeishuSendSentinels(normalizationAccountId, to, threadId, normalizationSentinels);
        return {
            messageId: response?.data?.message_id ?? '',
            chatId: response?.data?.chat_id ?? '',
        };
    }
    // Send as a new message.
    const target = (0, targets_1.normalizeFeishuTarget)(to);
    if (!target) {
        throw new Error(`[feishu-send] Invalid target: "${to}"`);
    }
    const receiveIdType = (0, targets_1.resolveReceiveIdType)(target);
    const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.create({
        params: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            receive_id_type: receiveIdType,
        },
        data: {
            receive_id: target,
            msg_type: 'post',
            content: contentPayload,
        },
    }), 'im.message.create(post)');
    recordFeishuSendSentinels(normalizationAccountId, to, threadId, normalizationSentinels);
    return {
        messageId: response?.data?.message_id ?? '',
        chatId: response?.data?.chat_id ?? '',
    };
}
// ---------------------------------------------------------------------------
// sendCardFeishu
// ---------------------------------------------------------------------------
/**
 * Send an interactive card message to a chat or user.
 *
 * @param params - See {@link SendFeishuCardParams}.
 * @returns The send result containing the new message ID.
 */
async function sendCardFeishu(params) {
    const { cfg, to, card, replyToMessageId, accountId, replyInThread } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const contentPayload = JSON.stringify(card);
    if (replyToMessageId) {
        // 规范化 message_id，处理合成 ID（如 "om_xxx:auth-complete"）
        const normalizedId = (0, targets_1.normalizeMessageId)(replyToMessageId);
        const response = await (0, message_unavailable_1.runWithMessageUnavailableGuard)({
            messageId: normalizedId,
            operation: 'im.message.reply(interactive)',
            fn: () => (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.reply({
                path: {
                    message_id: normalizedId,
                },
                data: {
                    content: contentPayload,
                    msg_type: 'interactive',
                    reply_in_thread: replyInThread,
                },
            }), 'im.message.reply(interactive)'),
        });
        return {
            messageId: response?.data?.message_id ?? '',
            chatId: response?.data?.chat_id ?? '',
        };
    }
    const target = (0, targets_1.normalizeFeishuTarget)(to);
    if (!target) {
        throw new Error(`[feishu-send] Invalid target: "${to}"`);
    }
    const receiveIdType = (0, targets_1.resolveReceiveIdType)(target);
    const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.create({
        params: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            receive_id_type: receiveIdType,
        },
        data: {
            receive_id: target,
            msg_type: 'interactive',
            content: contentPayload,
        },
    }), 'im.message.create(interactive)');
    return {
        messageId: response?.data?.message_id ?? '',
        chatId: response?.data?.chat_id ?? '',
    };
}
// ---------------------------------------------------------------------------
// updateCardFeishu
// ---------------------------------------------------------------------------
/**
 * Update (PATCH) the content of an existing interactive card message.
 *
 * Only messages originally sent by the bot can be updated. The card
 * must have been created with `"update_multi": true` in its config if
 * all recipients should see the update.
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.messageId - The card message ID to update.
 * @param params.card      - The new card content.
 * @param params.accountId - Optional account identifier.
 */
async function updateCardFeishu(params) {
    const { cfg, messageId, card, accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    await (0, message_unavailable_1.runWithMessageUnavailableGuard)({
        messageId,
        operation: 'im.message.patch(interactive)',
        fn: () => (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.patch({
            path: {
                message_id: messageId,
            },
            data: {
                content: JSON.stringify(card),
            },
        }), 'im.message.patch(interactive)'),
    });
}
// ---------------------------------------------------------------------------
// buildMarkdownCard
// ---------------------------------------------------------------------------
/**
 * Build a simple Feishu Interactive Message Card containing a single
 * markdown element.
 *
 * This is a convenience wrapper for the most common card layout: a
 * wide-screen card with one markdown block.
 *
 * @param text - The markdown text to render in the card.
 * @returns A card JSON object ready to be sent via {@link sendCardFeishu}.
 */
function buildMarkdownCard(text) {
    const optimizedText = (0, markdown_style_1.optimizeMarkdownStyle)(text);
    return {
        schema: '2.0',
        config: {
            wide_screen_mode: true,
        },
        body: {
            elements: [
                {
                    tag: 'markdown',
                    content: optimizedText,
                },
            ],
        },
    };
}
/**
 * Build an i18n-aware Feishu Interactive Message Card containing a single
 * markdown element with per-locale content.
 *
 * Uses the CardKit v2 `i18n_content` field so the Feishu client
 * auto-selects the locale matching the user's language setting.
 *
 * @param i18nTexts - A map of locale to markdown text (e.g. { zh_cn: '...', en_us: '...' }).
 * @returns A card JSON object ready to be sent via {@link sendCardFeishu}.
 */
function buildI18nMarkdownCard(i18nTexts) {
    const locales = Object.keys(i18nTexts);
    // Determine fallback content (prefer en_us, then first available locale).
    const fallbackLocale = locales.includes('en_us') ? 'en_us' : locales[0];
    const fallbackText = (0, markdown_style_1.optimizeMarkdownStyle)(i18nTexts[fallbackLocale]);
    // Build i18n_content with optimized text for each locale.
    const i18nContent = {};
    for (const [locale, text] of Object.entries(i18nTexts)) {
        i18nContent[locale] = (0, markdown_style_1.optimizeMarkdownStyle)(text);
    }
    return {
        schema: '2.0',
        config: {
            wide_screen_mode: true,
        },
        body: {
            elements: [
                {
                    tag: 'markdown',
                    content: fallbackText,
                    i18n_content: i18nContent,
                },
            ],
        },
    };
}
// ---------------------------------------------------------------------------
// sendMarkdownCardFeishu
// ---------------------------------------------------------------------------
/**
 * Build a markdown card and send it in one step.
 *
 * If mention targets are provided, they are prepended to the markdown
 * content using the card mention syntax.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.text             - Markdown content for the card.
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.mentions         - Optional mention targets.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result containing the new message ID.
 */
async function sendMarkdownCardFeishu(params) {
    const { cfg, to, text, replyToMessageId, mentions, accountId, replyInThread } = params;
    // Normalize @-mentions and apply the bot-peer ensureMention backstop on the
    // card path too (mirrors sendMessageFeishu), so a reply rendered as a card
    // still reaches the designated peer bot.
    const normalized = await normalizeFeishuOutboundText(cfg, to, text, accountId ?? undefined);
    let cardText = normalized.text;
    if (mentions && mentions.length > 0) {
        cardText = (0, mention_1.buildMentionedCardContent)(mentions, cardText);
    }
    const card = buildMarkdownCard(cardText);
    const result = await sendCardFeishu({
        cfg,
        to,
        card,
        replyToMessageId,
        replyInThread,
        accountId,
    });
    recordFeishuSendSentinels(normalized.resolvedAccountId, to, undefined, normalized.sentinels);
    return result;
}
// ---------------------------------------------------------------------------
// editMessageFeishu
// ---------------------------------------------------------------------------
/**
 * Edit the content of an existing message.
 *
 * Updates the message body via the IM message update API. Only
 * messages sent by the bot can be edited.
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.messageId - The message ID to edit.
 * @param params.text      - The new message text.
 * @param params.accountId - Optional account identifier.
 */
async function editMessageFeishu(params) {
    const { cfg, messageId, text, accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    // Use cardVersion=1 consistent with sendMessageFeishu post path.
    const optimizedText = (0, markdown_style_1.optimizeMarkdownStyle)(text, 1);
    const contentPayload = JSON.stringify({
        zh_cn: {
            content: [[{ tag: 'md', text: optimizedText }]],
        },
    });
    await (0, message_unavailable_1.runWithMessageUnavailableGuard)({
        messageId,
        operation: 'im.message.update(post)',
        fn: () => (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.update({
            path: {
                message_id: messageId,
            },
            data: {
                content: contentPayload,
                msg_type: 'post',
            },
        }), 'im.message.update(post)'),
    });
}
// ---------------------------------------------------------------------------
// deleteMessageFeishu
// ---------------------------------------------------------------------------
/**
 * Delete a bot-sent Feishu message (used to remove ephemeral tool-activity
 * cards once the static-mode final reply is delivered).
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.messageId - The message ID to delete.
 * @param params.accountId - Optional account identifier.
 */
async function deleteMessageFeishu(params) {
    const { cfg, messageId, accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    await (0, message_unavailable_1.runWithMessageUnavailableGuard)({
        messageId,
        operation: 'im.message.delete',
        fn: () => (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.delete({
            path: {
                message_id: messageId,
            },
        }), 'im.message.delete'),
    });
}
