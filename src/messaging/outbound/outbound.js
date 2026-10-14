"use strict";
// SPDX-License-Identifier: MIT
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishuOutbound = void 0;
const lark_client_1 = require("../../core/lark-client.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const targets_1 = require("../../core/targets.js");
const comment_target_1 = require("../../core/comment-target.js");
const synthetic_target_1 = require("../../core/synthetic-target.js");
const accounts_1 = require("../../core/accounts.js");
const deliver_1 = require("./deliver.js");
const media_1 = require("./media.js");
const native_card_1 = require("../../card/native-card.js");
const post_chunking_1 = require("./post-chunking.js");
const send_context_1 = require("./send-context.js");
const multi_image_mode_1 = require("./multi-image-mode.js");
const outbound_mention_1 = require("./outbound-mention.js");
const bot_peer_context_1 = require("./bot-peer-context.js");
/**
 * Apply the outbound mention safety net for the current send:
 *  - rewrite LLM-emitted @-shapes into Feishu's standard <at> element
 *  - when the dispatch layer marked the current reply as bot→bot in a
 *    group (via `runWithBotPeerContext`), guarantee the peer bot is
 *    explicitly @-mentioned so Feishu delivers the message at all.
 */
function applyOutboundMentions(text, chatId) {
    const normalized = (0, outbound_mention_1.normalizeOutboundMentions)(text, chatId);
    const peer = (0, bot_peer_context_1.currentBotPeerContext)();
    // De-dupe the peer @ across chunks: once it has appeared on one chunk
    // (model-written or injected), later chunks of the same dispatch skip it.
    // Mirrors normalizeFeishuOutboundText in send.ts so both outbound paths
    // behave the same and a long multi-chunk reply doesn't @ the peer repeatedly.
    if (!peer || peer.mentioned)
        return normalized;
    const out = (0, outbound_mention_1.ensureMention)(normalized, peer.peerOpenId, peer.peerName);
    if (out.includes(`user_id="${peer.peerOpenId}"`)) {
        peer.mentioned = true;
    }
    return out;
}
const log = (0, lark_logger_1.larkLogger)('outbound/outbound');
/**
 * Forward a per-physical-send delivery result to the core callback.
 *
 * Core passes `onDeliveryResult` into the adapter (via its outbound bridge)
 * and uses each receipt for partial-delivery accounting and subagent/cron
 * completion tracking. Ported from @openclaw/feishu `reportFeishuOutboundDelivery`
 * (channel.ts / outbound.ts). No-op when the host does not provide the callback.
 *
 * A failure in the host callback must NOT fail a send that already succeeded
 * (that would make core treat a delivered message as retryable and duplicate
 * it), so errors are logged and swallowed.
 */
async function reportDeliveryResult(onDeliveryResult, result) {
    if (typeof onDeliveryResult !== 'function')
        return;
    try {
        await onDeliveryResult(result);
    }
    catch (err) {
        log.warn(`onDeliveryResult callback failed (send already delivered): ${String(err)}`);
    }
}
/**
 * Map adapter-level parameters to internal send context.
 *
 * Mirrors the pattern used by Telegram (`resolveTelegramSendContext`) and
 * Slack (`sendSlackOutboundMessage`) to centralise parameter mapping.
 */
function resolveFeishuSendContext(params) {
    const routeTarget = (0, targets_1.parseFeishuRouteTarget)(params.to);
    const explicitThreadId = params.threadId != null && String(params.threadId).trim() !== '' ? String(params.threadId).trim() : undefined;
    const explicitReplyToId = params.replyToId?.trim() || undefined;
    const replyToMessageId = explicitReplyToId ?? routeTarget.replyToMessageId;
    const replyInThread = Boolean(explicitThreadId ?? routeTarget.threadId);
    if (!explicitReplyToId && routeTarget.replyToMessageId) {
        log.info('resolved reply target from encoded originating route');
    }
    return {
        cfg: params.cfg,
        to: routeTarget.target,
        replyToMessageId,
        replyInThread,
        threadId: explicitThreadId,
        accountId: params.accountId ?? undefined,
    };
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
exports.feishuOutbound = {
    deliveryMode: 'direct',
    // Envelope-aware: split by character limit AND by the serialized 30 KB
    // rich-post byte limit, so multi-byte/CJK replies are never rejected.
    // Ported from @openclaw/feishu `chunkFeishuPostMarkdown`.
    chunker: (text, limit) => (0, post_chunking_1.chunkFeishuPostMarkdown)({ text, limit }),
    chunkerMode: 'markdown',
    textChunkLimit: 15000,
    sendText: async ({ cfg, to, text, accountId, replyToId, threadId, onDeliveryResult }) => {
        log.info(`sendText: target=${to}, textLength=${text.length}`);
        // Synthetic targets (e.g. VC meeting-invited) have no real IM peer —
        // drop the send silently so the agent pipeline stays uniform without
        // producing unsolicited DMs. See core/synthetic-target.ts.
        if ((0, synthetic_target_1.isSyntheticTarget)(to)) {
            log.debug(`sendText: synthetic target ${to}, dropping outbound IM send`);
            return { channel: 'feishu', messageId: '', chatId: to };
        }
        // Comment thread routing — route replies through Drive comment API
        if ((0, comment_target_1.isCommentTarget)(to)) {
            log.info(`sendText: detected comment target, routing through Drive comment API`);
            const result = await (0, deliver_1.sendCommentReplyLark)({ cfg, to, text, accountId: accountId ?? undefined });
            const out = { channel: 'feishu', ...result };
            await reportDeliveryResult(onDeliveryResult, out);
            return out;
        }
        const ctx = resolveFeishuSendContext({ cfg, to, accountId, replyToId, threadId });
        const finalText = applyOutboundMentions(text, ctx.to);
        const result = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text: finalText });
        const out = { channel: 'feishu', ...result };
        await reportDeliveryResult(onDeliveryResult, out);
        return out;
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId, replyToId, threadId, onDeliveryResult }) => {
        log.info(`sendMedia: target=${to}, ` + `hasText=${Boolean(text?.trim())}, mediaUrl=${mediaUrl ?? '(none)'}`);
        // Synthetic targets — drop silently (see sendText for rationale).
        if ((0, synthetic_target_1.isSyntheticTarget)(to)) {
            log.debug(`sendMedia: synthetic target ${to}, dropping outbound IM send`);
            return { channel: 'feishu', messageId: '', chatId: to };
        }
        // Comment thread routing — send text (with media URL appended) via Drive comment API
        if ((0, comment_target_1.isCommentTarget)(to)) {
            log.info(`sendMedia: detected comment target, routing through Drive comment API`);
            const parts = [];
            if (text?.trim())
                parts.push(text.trim());
            if (mediaUrl)
                parts.push(`📎 ${mediaUrl}`);
            const combinedText = parts.join('\n') || '(media)';
            const result = await (0, deliver_1.sendCommentReplyLark)({ cfg, to, text: combinedText, accountId: accountId ?? undefined });
            const out = { channel: 'feishu', ...result };
            await reportDeliveryResult(onDeliveryResult, out);
            return out;
        }
        const ctx = resolveFeishuSendContext({ cfg, to, accountId, replyToId, threadId });
        const normalizedCaption = text ? applyOutboundMentions(text, ctx.to) : text;
        // Feishu media messages do not support inline captions — send text first.
        // Capture the result so the no-mediaUrl path can return it without re-sending.
        let captionResult;
        if (normalizedCaption?.trim()) {
            captionResult = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text: normalizedCaption });
            await reportDeliveryResult(onDeliveryResult, { channel: 'feishu', ...captionResult });
        }
        // No mediaUrl — text-only flow.
        if (!mediaUrl) {
            log.info('sendMedia: no mediaUrl provided, falling back to text-only');
            if (captionResult) {
                // Caption was already sent and reported above; return that result.
                return { channel: 'feishu', ...captionResult };
            }
            // No caption text — send empty/raw text to satisfy the contract.
            const result = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text: normalizedCaption ?? '' });
            const out = { channel: 'feishu', ...result };
            await reportDeliveryResult(onDeliveryResult, out);
            return out;
        }
        const result = await (0, deliver_1.sendMediaLark)({ ...ctx, to: ctx.to, mediaUrl, mediaLocalRoots });
        const out = {
            channel: 'feishu',
            messageId: result.messageId,
            chatId: result.chatId,
            ...(result.warning ? { meta: { warnings: [result.warning] } } : {}),
        };
        await reportDeliveryResult(onDeliveryResult, out);
        return out;
    },
    sendPayload: async ({ cfg, to, payload, mediaLocalRoots, accountId, replyToId, threadId, onDeliveryResult }) => {
        // Synthetic targets — drop silently (see sendText for rationale).
        if ((0, synthetic_target_1.isSyntheticTarget)(to)) {
            log.debug(`sendPayload: synthetic target ${to}, dropping outbound IM send`);
            return { channel: 'feishu', messageId: '', chatId: to };
        }
        const ctx = resolveFeishuSendContext({ cfg, to, accountId, replyToId, threadId });
        // --- channelData.feishu: card message support ---
        const feishuData = payload.channelData?.feishu;
        // --- Resolve text + media from payload ---
        const text = payload.text ?? '';
        const mediaUrls = payload.mediaUrls?.length ? payload.mediaUrls : payload.mediaUrl ? [payload.mediaUrl] : [];
        log.info(`sendPayload: target=${to}, ` +
            `textLength=${text.length}, mediaCount=${mediaUrls.length}, ` +
            `hasCard=${Boolean(feishuData?.card)}`);
        // --- channelData.feishu.card: card message path ---
        // Feishu card messages are standalone (msg_type="interactive"), so
        // text and media must be sent as separate messages around the card.
        // Sanitise the model-authored card; if nothing usable survives, treat it
        // as absent and fall through to the standard text/media path.
        const modelCard = feishuData?.card
            ? (0, native_card_1.sanitizeModelAuthoredCard)(feishuData.card)
            : undefined;
        if (modelCard) {
            if (text.trim()) {
                const textResult = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text });
                await reportDeliveryResult(onDeliveryResult, { channel: 'feishu', ...textResult });
            }
            const cardResult = await (0, deliver_1.sendCardLark)({ ...ctx, to: ctx.to, card: modelCard });
            await reportDeliveryResult(onDeliveryResult, { channel: 'feishu', ...cardResult });
            const warnings = [];
            for (const mediaUrl of mediaUrls) {
                const mediaResult = await (0, deliver_1.sendMediaLark)({ ...ctx, to: ctx.to, mediaUrl, mediaLocalRoots });
                await reportDeliveryResult(onDeliveryResult, {
                    channel: 'feishu',
                    messageId: mediaResult.messageId,
                    chatId: mediaResult.chatId,
                    ...(mediaResult.warning ? { meta: { warnings: [mediaResult.warning] } } : {}),
                });
                if (mediaResult.warning) {
                    warnings.push(mediaResult.warning);
                }
            }
            return {
                channel: 'feishu',
                messageId: cardResult.messageId,
                chatId: cardResult.chatId,
                ...(warnings.length > 0 ? { meta: { warnings } } : {}),
            };
        }
        // --- Standard text + media orchestration (no card) ---
        // No media: text-only
        if (mediaUrls.length === 0) {
            const result = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text });
            const out = { channel: 'feishu', ...result };
            await reportDeliveryResult(onDeliveryResult, out);
            return out;
        }
        // Has media: send leading text, then media
        if (text.trim()) {
            const textResult = await (0, deliver_1.sendTextLark)({ ...ctx, to: ctx.to, text });
            await reportDeliveryResult(onDeliveryResult, { channel: 'feishu', ...textResult });
        }
        // --- Multi-image merge (default): one Feishu post, one img per paragraph ---
        // Feishu has no album/media-group API, so ≥2 image URLs are merged into
        // a single rich-text post by default. Opt out per account/global with
        // `channels.feishu.multiImageMode: "sequential"`. Any failure in the
        // merged path (e.g. an upload error) falls back to sequential sends so
        // no image is lost. Mixed media (non-image among the URLs) always uses
        // the sequential loop below.
        const account = (0, accounts_1.getLarkAccount)(cfg, ctx.accountId ?? undefined);
        const multiImageMode = (0, multi_image_mode_1.resolveMultiImageMode)(account.config);
        if (multiImageMode === 'post' &&
            mediaUrls.length >= 2 &&
            mediaUrls.every((mediaUrl) => (0, media_1.isImageMediaUrl)(mediaUrl))) {
            try {
                // Upload every image up-front so a partial failure aborts the
                // merged path before any message is sent.
                const imageKeys = [];
                for (const mediaUrl of mediaUrls) {
                    const uploaded = await (0, media_1.uploadImageFromUrlLark)({
                        cfg,
                        mediaUrl,
                        mediaLocalRoots,
                        accountId: ctx.accountId ?? undefined,
                    });
                    imageKeys.push(uploaded.imageKey);
                }
                const groupResult = await (0, deliver_1.sendImageGroupPostLark)({
                    ...ctx,
                    to: ctx.to,
                    imageKeys,
                });
                log.info(`sendPayload: sent ${imageKeys.length} images as a single post`);
                const out = { channel: 'feishu', messageId: groupResult.messageId, chatId: groupResult.chatId };
                await reportDeliveryResult(onDeliveryResult, out);
                return out;
            }
            catch (err) {
                log.warn(`sendPayload: multi-image post failed (${err instanceof Error ? err.message : String(err)}), ` +
                    `falling back to sequential image sends`);
            }
        }
        const warnings = [];
        let lastResult;
        for (const mediaUrl of mediaUrls) {
            lastResult = await (0, deliver_1.sendMediaLark)({ ...ctx, to: ctx.to, mediaUrl, mediaLocalRoots });
            await reportDeliveryResult(onDeliveryResult, {
                channel: 'feishu',
                messageId: lastResult.messageId,
                chatId: lastResult.chatId,
                ...(lastResult.warning ? { meta: { warnings: [lastResult.warning] } } : {}),
            });
            if (lastResult.warning) {
                warnings.push(lastResult.warning);
            }
        }
        return {
            channel: 'feishu',
            ...(lastResult ?? { messageId: '', chatId: '' }),
            ...(warnings.length > 0 ? { meta: { warnings } } : {}),
        };
    },
};
// Establish the host's send-authority scope for every adapter entry point, so
// a retired/aborted turn cannot dispatch and every physical send re-checks.
// Ported from @openclaw/feishu `src/send-context.ts`.
for (const entry of ['sendText', 'sendMedia', 'sendPayload']) {
    const original = exports.feishuOutbound[entry];
    if (typeof original !== 'function') {
        continue;
    }
    exports.feishuOutbound[entry] = (args) => (0, send_context_1.withFeishuSendContext)({
        signal: args?.signal,
        assertDirectAdapterHandoff: args?.assertDirectAdapterHandoff,
        onPlatformSendDispatch: args?.onPlatformSendDispatch,
    }, () => original(args));
}
