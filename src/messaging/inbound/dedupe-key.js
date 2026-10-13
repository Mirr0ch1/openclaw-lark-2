"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Retry-stable inbound dedupe keys.
 *
 * Adapted from @openclaw/feishu `src/dedupe-key.ts`, scoped to text/post
 * messages. Media messages (image/file/audio/sticker) keep the plain
 * message_id key: a media redelivery that carries a *fresh* message_id is
 * not caught here (upstream additionally keys on the media `image_key`/
 * `file_key`; add that if such duplicates are observed).
 *
 * Feishu can redeliver the same logical text message with a *fresh*
 * message_id (retry / WebSocket reconnect), which defeats plain
 * message_id-based dedupe (#46778). For text we key on a stable retry
 * identity instead: same sender + chat + create_time + content is the
 * same logical message. `create_time` is the message's own server
 * timestamp and stays fixed across redeliveries, so genuine repeat sends
 * (which get a new create_time) keep distinct keys and are never
 * suppressed.
 *
 * Falls back to message_id whenever any field is missing, so behavior is
 * unchanged for those cases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeishuMessageDedupeKey = resolveFeishuMessageDedupeKey;
exports.resolveTextRetryDedupeKey = resolveTextRetryDedupeKey;
const node_crypto_1 = require("node:crypto");
function readTrimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function isStrictNonNegativeInteger(value) {
    if (value === undefined)
        return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0;
}
function resolveSenderIdentity(event) {
    const senderId = event.sender?.sender_id;
    return (readTrimmed(senderId?.open_id) ||
        readTrimmed(senderId?.union_id) ||
        readTrimmed(senderId?.user_id) ||
        undefined);
}
function resolveTextRetryDedupeKey(event) {
    const createTime = readTrimmed(event.message?.create_time);
    const chatId = readTrimmed(event.message?.chat_id);
    const senderId = resolveSenderIdentity(event);
    if (!createTime || !isStrictNonNegativeInteger(createTime) || !chatId || !senderId) {
        return undefined;
    }
    const contentHash = (0, node_crypto_1.createHash)('sha256')
        .update(String(event.message?.content ?? ''), 'utf8')
        .digest('hex')
        .slice(0, 32);
    return JSON.stringify(['text-retry', senderId, chatId, createTime, contentHash]);
}
/** Resolve the dedupe key for an inbound Feishu message event. */
function resolveFeishuMessageDedupeKey(event) {
    const messageId = readTrimmed(event.message?.message_id);
    if (!messageId) {
        return undefined;
    }
    const messageType = readTrimmed(event.message?.message_type);
    if (messageType === 'text') {
        return resolveTextRetryDedupeKey(event) ?? messageId;
    }
    if (messageType === 'post') {
        const retryKey = resolveTextRetryDedupeKey(event);
        if (!retryKey) {
            return messageId;
        }
        const topicId = readTrimmed(event.message?.root_id) || readTrimmed(event.message?.thread_id);
        return topicId ? JSON.stringify([retryKey, topicId]) : retryKey;
    }
    return messageId;
}
