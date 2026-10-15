"use strict";
// SPDX-License-Identifier: MIT
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTextLark = sendTextLark;
exports.sendCardLark = sendCardLark;
exports.sendImageGroupPostLark = sendImageGroupPostLark;
exports.sendMediaLark = sendMediaLark;
exports.sendCommentReplyLark = sendCommentReplyLark;
exports.resolvePublicMediaReference = resolvePublicMediaReference;
const accounts_1 = require("../../core/accounts.js");
const lark_client_1 = require("../../core/lark-client.js");
const chat_queue_1 = require("../../channel/chat-queue.js");
const targets_1 = require("../../core/targets.js");
const send_rate_limit_1 = require("./send-rate-limit.js");
const comment_target_1 = require("../../core/comment-target.js");
const markdown_style_1 = require("../../card/markdown-style.js");
const native_card_1 = require("../../card/native-card.js");
const send_context_1 = require("./send-context.js");
const api_error_1 = require("../../core/api-error.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const sentinel_store_1 = require("../inbound/sentinel-store.js");
const media_1 = require("./media.js");
const normalize_mentions_1 = require("./normalize-mentions.js");
const ssrf_1 = require("openclaw/plugin-sdk/ssrf-runtime");
const log = (0, lark_logger_1.larkLogger)('outbound/deliver');
/** Text used when a media upload fails and no public link can be echoed. */
const MEDIA_UPLOAD_FAILED_TEXT = 'Media upload failed. Please try again.';
/**
 * Resolve a media URL that is safe to echo as a clickable fallback link.
 *
 * Ported from the official `resolvePublicFeishuMediaReference`: only http(s)
 * URLs whose host is not blocked/private (and whose DNS resolves to a public
 * address) are returned. A local file path, a control-character-injected
 * string, or an internal URL resolves to `undefined` — the caller then sends a
 * generic failure message instead of leaking the reference into the chat.
 */
async function resolvePublicMediaReference(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw)
        return undefined;
    // Reject ASCII control characters (log/header injection).
    for (const ch of raw) {
        const code = ch.charCodeAt(0);
        if (code <= 0x1f || code === 0x7f)
            return undefined;
    }
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            return undefined;
        if (parsed.username || parsed.password || (0, ssrf_1.isBlockedHostnameOrIp)(parsed.hostname))
            return undefined;
        // A proxy route cannot prove its destination is public — fail closed
        // unless the pinned DNS lookup validates a public address.
        await (0, ssrf_1.resolvePinnedHostnameWithPolicy)(parsed.hostname);
        return parsed.href;
    }
    catch {
        return undefined;
    }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Build a Feishu post-format content envelope from processed text.
 */
function buildPostContent(text) {
    return JSON.stringify({
        zh_cn: {
            content: [[{ tag: 'md', text }]],
        },
    });
}
/**
 * Pre-processes text before Feishu delivery. Runs the full mention
 * normalizer (tag rewrite + plain `@Name` resolution + `@all` aliases)
 * and Markdown style optimization. Markdown tables/code blocks are left
 * as-is so Feishu renders them natively in the post(`tag:md`).
 *
 * Falls back to the raw text on any normalizer failure so a parser bug
 * never blocks send. Sentinels collected during normalization are
 * returned for the caller to record after the send succeeds.
 */
async function prepareTextForLark(cfg, text, to, accountId) {
    let processed = text;
    let sentinels = [];
    let resolvedAccountId = accountId;
    if (text?.trim()) {
        try {
            const account = (0, accounts_1.getLarkAccount)(cfg, accountId ?? undefined);
            const ctx = {
                chatId: to,
                account,
                log: (...args) => log.warn(args.map(String).join(' ')),
            };
            const r = await (0, normalize_mentions_1.normalizeOutboundMentions)(text, ctx);
            processed = r.normalizedText;
            sentinels = r.sentinels;
            resolvedAccountId = account.accountId;
        }
        catch (err) {
            log.warn(`normalizeOutboundMentions failed in prepareTextForLark, using raw text: ${String(err)}`);
        }
    }
    return {
        text: (0, markdown_style_1.optimizeMarkdownStyle)(processed, 1),
        sentinels,
        resolvedAccountId,
    };
}
function recordSentinelsForChat(resolvedAccountId, to, threadId, sentinels) {
    if (!resolvedAccountId || sentinels.length === 0)
        return;
    (0, sentinel_store_1.getSentinelStore)(resolvedAccountId).recordSentinels((0, chat_queue_1.threadScopedKey)(to, threadId), sentinels);
}
/**
 * Unified IM message sender — handles both reply and create paths for any
 * `msg_type`.  Replaces the former `replyPostMessage`, `createPostMessage`,
 * `replyInteractiveMessage` and `createInteractiveMessage` helpers.
 */
async function sendImMessage(params) {
    const { client, to, content, msgType, replyToMessageId, replyInThread } = params;
    // --- Reply path ---
    if (replyToMessageId) {
        log.info(`replying to message ${replyToMessageId} ` + `(msg_type=${msgType}, thread=${replyInThread ?? false})`);
        const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.reply({
            path: { message_id: replyToMessageId },
            data: { content, msg_type: msgType, reply_in_thread: replyInThread },
        }), 'im.message.reply');
        const result = {
            messageId: response?.data?.message_id ?? '',
            chatId: response?.data?.chat_id ?? '',
        };
        log.debug(`reply sent: messageId=${result.messageId}`);
        return result;
    }
    // --- Create path ---
    const target = (0, targets_1.normalizeFeishuTarget)(to);
    if (!target) {
        throw new Error(`Cannot send message: "${to}" is not a valid target. ` + `Expected a chat_id (oc_*), open_id (ou_*), or user_id.`);
    }
    const receiveIdType = (0, targets_1.resolveReceiveIdType)(target);
    log.info(`creating message to ${target} (msg_type=${msgType})`);
    const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: { receive_id_type: receiveIdType },
        data: { receive_id: target, msg_type: msgType, content },
    }), 'im.message.create');
    const result = {
        messageId: response?.data?.message_id ?? '',
        chatId: response?.data?.chat_id ?? '',
    };
    log.debug(`message created: messageId=${result.messageId}`);
    return result;
}
/**
 * Detect whether a text string is a complete Feishu card JSON (v1, v2, or template).
 *
 * Returns the parsed card object if the text is valid card JSON, or
 * `undefined` if it is plain text. Detection is conservative — only
 * triggers when the **entire** trimmed text is a JSON object with
 * recognisable card structure markers.
 *
 * - **v2**: top-level `schema` equals `"2.0"`
 * - **v1**: has an `elements` array AND at least `config` or `header`
 * - **template**: `type` equals `"template"` with `data.template_id`
 * - **wrapped**: `msg_type` or `type` equals `"interactive"` with a nested `card` object
 */
function detectCardJson(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
            return undefined;
        }
        const obj = parsed;
        // v2 CardKit — must declare schema "2.0"
        if (obj.schema === '2.0')
            return obj;
        // v1 Message Card — must have elements[] AND (config OR header)
        if (Array.isArray(obj.elements) && (obj.config !== undefined || obj.header !== undefined)) {
            return obj;
        }
        // Template card — type: "template" with data.template_id
        if (obj.type === 'template' &&
            typeof obj.data === 'object' &&
            obj.data != null &&
            typeof obj.data.template_id === 'string') {
            return obj;
        }
        // Wrapped card — AI sometimes wraps card JSON with msg_type/type: "interactive"
        if ((obj.msg_type === 'interactive' || obj.type === 'interactive') &&
            typeof obj.card === 'object' &&
            obj.card != null) {
            return obj.card;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Send a text message to a Feishu chat or user.
 *
 * Standalone implementation that directly operates the Lark SDK.
 * The text is pre-processed (table conversion, style optimization)
 * and sent as a Feishu "post" message with markdown rendering.
 *
 * If the entire text is a valid Feishu card JSON string (v1 or v2),
 * it is automatically detected and routed to {@link sendCardLark}
 * instead of being sent as plain text.
 *
 * @param params - See {@link SendTextLarkParams}.
 * @returns The message ID and chat ID.
 * @throws {Error} When the target is invalid or the API call fails.
 *
 * @example
 * ```ts
 * const result = await sendTextLark({
 *   cfg,
 *   to: "oc_xxx",
 *   text: "Hello from Feishu",
 * });
 * ```
 */
async function sendTextLark(params) {
    const { cfg, to, text, replyToMessageId, replyInThread, accountId, threadId } = params;
    // Detect card JSON in text — route to card sending before text preprocessing.
    // Sanitise model-authored card JSON before send (unsafe button URLs /
    // callback values stripped, text escaped, elements allowlisted); when
    // nothing usable survives, fall through to plain-text rendering.
    // Sanitiser ported from @openclaw/feishu `sanitizeNativeFeishuCard`.
    const detectedCard = detectCardJson(text);
    const card = detectedCard ? (0, native_card_1.sanitizeModelAuthoredCard)(detectedCard) : undefined;
    if (card) {
        const version = card.schema === '2.0' ? 'v2' : 'v1';
        log.info(`detected ${version} card JSON in text (target=${to}), routing to sendCardLark`);
        return sendCardLark({ cfg, to, card, replyToMessageId, replyInThread, accountId });
    }
    log.info(`sendTextLark: target=${to}, textLength=${text.length}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const prepared = await prepareTextForLark(cfg, text, to, accountId);
    const content = buildPostContent(prepared.text);
    const result = await sendImMessage({ client, to, content, msgType: 'post', replyToMessageId, replyInThread });
    recordSentinelsForChat(prepared.resolvedAccountId, to, threadId, prepared.sentinels);
    return result;
}
/**
 * Send a Feishu rich-text post embedding several already-uploaded images.
 *
 * Feishu has no album/media-group API (unlike Telegram's `sendMediaGroup`),
 * but a `post` message may carry multiple `img` elements — each image must
 * occupy its own paragraph. This sends N images as ONE message with a single
 * API call, rendering like an album in the chat.
 *
 * The caller is responsible for uploading each image to Feishu first and
 * passing the resulting `image_key` values, so a partial failure can be
 * detected before anything is sent (and the caller falls back to sequential
 * per-image messages).
 *
 * @param params - See {@link SendImageGroupPostLarkParams}.
 * @returns The message ID and chat ID of the combined post.
 * @throws {Error} When the target is invalid or the API call fails.
 *
 * @example
 * ```ts
 * const result = await sendImageGroupPostLark({
 *   cfg,
 *   to: "oc_xxx",
 *   imageKeys: ["img_v2_aaa", "img_v2_bbb"],
 * });
 * ```
 */
async function sendImageGroupPostLark(params) {
    const { cfg, to, imageKeys, replyToMessageId, replyInThread, accountId } = params;
    log.info(`sendImageGroupPostLark: target=${to}, imageCount=${imageKeys.length}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify({
        zh_cn: {
            // Rich-text post paragraphs: one `img` element per paragraph.
            content: imageKeys.map((imageKey) => [{ tag: 'img', image_key: imageKey }]),
        },
    });
    return sendImMessage({ client, to, content, msgType: 'post', replyToMessageId, replyInThread });
}
/**
 * Send an interactive card message to a Feishu chat or user.
 *
 * Supports both v1 (Message Card) and v2 (CardKit) card formats.
 * The card JSON is serialised and sent as `msg_type: "interactive"`.
 *
 * @param params - See {@link SendCardLarkParams}.
 * @returns The message ID and chat ID.
 * @throws {Error} When the target is invalid or the API call fails.
 *
 * @example
 * ```ts
 * // v1 card
 * const result = await sendCardLark({
 *   cfg,
 *   to: "oc_xxx",
 *   card: {
 *     config: { wide_screen_mode: true },
 *     header: { title: { tag: "plain_text", content: "Hello" }, template: "blue" },
 *     elements: [{ tag: "div", text: { tag: "lark_md", content: "world" } }],
 *   },
 * });
 *
 * // v2 card
 * const result2 = await sendCardLark({
 *   cfg,
 *   to: "oc_xxx",
 *   card: {
 *     schema: "2.0",
 *     config: { wide_screen_mode: true },
 *     body: { elements: [{ tag: "markdown", content: "Hello **world**" }] },
 *   },
 * });
 * ```
 */
async function sendCardLark(params) {
    const { cfg, to, card, replyToMessageId, replyInThread, accountId } = params;
    const version = card.schema === '2.0' ? 'v2' : 'v1';
    log.info(`sendCardLark: target=${to}, cardVersion=${version}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify(card);
    try {
        return await sendImMessage({ client, to, content, msgType: 'interactive', replyToMessageId, replyInThread });
    }
    catch (err) {
        // A retired turn must surface as-is: re-wrapping it would drop
        // `retryable:false` and the host would retry a stale send.
        if (err instanceof send_context_1.PlatformMessageNotDispatchedError) {
            throw err;
        }
        const detail = (0, api_error_1.formatLarkError)(err);
        log.error(`sendCardLark failed: ${detail}`);
        throw new Error(`Card send failed: ${detail}\n\n` +
            `Troubleshooting:\n` +
            `- Do NOT use img/image elements with fabricated img_key values — Feishu rejects invalid keys.\n` +
            `- Do NOT put URLs in img_key — it must be a real image_key from uploadImage.\n` +
            `- Prefer text-only cards (markdown elements) which have 100% success rate.\n` +
            `- If you need images, send them as separate media messages, not inside cards.`, { cause: err });
    }
}
/**
 * Send a single media message to a Feishu chat or user.
 *
 * Pure atomic operation — uploads the media and sends it. On upload
 * failure, falls back to sending the URL as a clickable text link.
 *
 * This function does **not** handle leading text or multi-media
 * orchestration; those concerns belong to the adapter's `sendMedia`
 * and `sendPayload` methods.
 *
 * @param params - See {@link SendMediaLarkParams}.
 * @returns The message ID and chat ID of the sent message.
 * @throws {Error} When the target is invalid or all send attempts fail.
 *
 * @example
 * ```ts
 * const result = await sendMediaLark({
 *   cfg,
 *   to: "oc_xxx",
 *   mediaUrl: "https://example.com/image.png",
 * });
 * ```
 */
async function sendMediaLark(params) {
    const { cfg, to, mediaUrl, replyToMessageId, replyInThread, accountId, mediaLocalRoots } = params;
    log.info(`sendMediaLark: target=${to}, mediaUrl=${mediaUrl}`);
    try {
        const result = await (0, media_1.uploadAndSendMediaLark)({
            cfg,
            to,
            mediaUrl,
            replyToMessageId,
            replyInThread,
            accountId,
            mediaLocalRoots,
        });
        log.info(`media sent: messageId=${result.messageId}`);
        return { messageId: result.messageId, chatId: result.chatId };
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`sendMediaLark failed for "${mediaUrl}": ${errMsg}`);
        // Fallback: send the URL as a clickable text link — but only when it is
        // provably a public http(s) reference. A private/local path would leak
        // an internal URL into the chat, so a generic message is sent instead.
        const publicUrl = await resolvePublicMediaReference(mediaUrl);
        log.info(publicUrl ? `falling back to text link for "${publicUrl}"` : 'media fallback: no public link, sending failure notice');
        const fallbackResult = await sendTextLark({
            cfg,
            to,
            text: publicUrl ? `\u{1F4CE} ${publicUrl}` : MEDIA_UPLOAD_FAILED_TEXT,
            replyToMessageId,
            replyInThread,
            accountId,
        });
        return {
            ...fallbackResult,
            warning: `Media upload failed for "${mediaUrl}" (${errMsg}). ` +
                (publicUrl
                    ? 'A text link was sent instead. The user may need to open the link manually.'
                    : 'A failure notice was sent instead.'),
        };
    }
}
/**
 * Send a text message to a Feishu Drive comment surface.
 *
 * Parses the comment target from `to`, then chooses one of two delivery
 * strategies:
 * - `reply`        → reply in the existing comment thread
 * - `create_whole` → create a new whole-document comment
 *
 * Returns a synthetic FeishuSendResult (no IM messageId).
 *
 * @throws {Error} When the target is not a valid comment target or API fails.
 */
async function sendCommentReplyLark(params) {
    const { cfg, to, text, accountId } = params;
    const target = (0, comment_target_1.parseFeishuCommentTarget)(to);
    if (!target) {
        throw new Error(`Not a valid comment target: "${to}"`);
    }
    log.info(`sendCommentReplyLark: mode=${target.deliveryMode}, comment=${target.commentId}, textLength=${text.length}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId);
    const elements = [{ type: 'text_run', text_run: { text } }];
    if (target.deliveryMode === 'create_whole') {
        try {
            await client.sdk.drive.v1.fileComment.create({
                path: { file_token: target.fileToken },
                params: {
                    file_type: target.fileType,
                    user_id_type: 'open_id',
                },
                data: {
                    reply_list: {
                        replies: [
                            {
                                content: {
                                    elements,
                                },
                            },
                        ],
                    },
                },
            });
            log.info(`whole comment created successfully`);
            return {
                messageId: `comment-create:${target.commentId}`,
                chatId: to,
            };
        }
        catch (err) {
            const detail = (0, api_error_1.formatLarkError)(err);
            log.error(`sendCommentReplyLark failed to create whole comment: ${detail}`);
            throw new Error(`Comment create failed: ${detail}`, { cause: err });
        }
    }
    // sdk.request defaults to tenant_access_token (bot identity).
    // Dual payload format: try content.elements first, fallback to reply_elements.
    const url = `/open-apis/drive/v1/files/${target.fileToken}/comments/${target.commentId}/replies`;
    const queryParams = { file_type: target.fileType, user_id_type: 'open_id' };
    try {
        await client.sdk.request({
            method: 'POST',
            url,
            params: queryParams,
            data: { content: { elements } },
        });
        log.info(`comment reply sent successfully`);
        return {
            messageId: `comment-reply:${target.commentId}`,
            chatId: to,
        };
    }
    catch (firstErr) {
        // Fallback: some API versions use reply_elements format
        try {
            await client.sdk.request({
                method: 'POST',
                url,
                params: queryParams,
                data: { reply_elements: elements },
            });
            log.info(`comment reply sent successfully (reply_elements fallback)`);
            return {
                messageId: `comment-reply:${target.commentId}`,
                chatId: to,
            };
        }
        catch (secondErr) {
            const detail = (0, api_error_1.formatLarkError)(firstErr);
            log.error(`sendCommentReplyLark failed: ${detail}`);
            throw new Error(`Comment reply failed: ${detail}`, { cause: secondErr });
        }
    }
}
