"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * @mention utilities for the Lark/Feishu channel plugin.
 *
 * All logic is based on `MentionInfo[]` from `MessageContext.mentions`.
 * Provides:
 * - Derive helpers: `mentionedBot()`, `nonBotMentions()`
 * - Format helpers for outbound text and card messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMentionAll = isMentionAll;
exports.mentionedBot = mentionedBot;
exports.nonBotMentions = nonBotMentions;
exports.extractMessageBody = extractMessageBody;
exports.formatMentionForText = formatMentionForText;
exports.formatMentionAllForText = formatMentionAllForText;
exports.formatMentionForCard = formatMentionForCard;
exports.formatMentionAllForCard = formatMentionAllForCard;
exports.buildMentionedMessage = buildMentionedMessage;
exports.buildMentionedCardContent = buildMentionedCardContent;
const utils_1 = require("../converters/utils.js");
// ---------------------------------------------------------------------------
// Derive helpers (work on MentionInfo[])
// ---------------------------------------------------------------------------
/**
 * Detect whether a raw mention entry represents @all / 所有人 (a broadcast).
 *
 * Matches the official `isFeishuBroadcastMention`: the `key` may be `@all` or
 * `@_all` (case-insensitive), and any of the id fields may be the literal
 * `all`. Matching on `key` alone missed locales/versions that emit `@all`.
 */
function isMentionAll(mention) {
    const key = typeof mention?.key === 'string' ? mention.key.trim().toLowerCase() : '';
    if (key === '@all' || key === '@_all') {
        return true;
    }
    const ids = [mention?.id?.open_id, mention?.id?.user_id, mention?.id?.union_id];
    return ids.some((id) => typeof id === 'string' && id.trim().toLowerCase() === 'all');
}
/** Whether the receiving bot itself was @-mentioned. */
function mentionedBot(ctx) {
    return ctx.mentions.some((m) => m.isBot);
}
/** All mentions excluding the receiving bot itself. */
function nonBotMentions(ctx) {
    return ctx.mentions.filter((m) => !m.isBot);
}
// ---------------------------------------------------------------------------
// extractMessageBody
// ---------------------------------------------------------------------------
/**
 * Remove all @mention placeholder keys from the message text.
 */
function extractMessageBody(text, allMentionKeys) {
    let result = text;
    for (const key of allMentionKeys) {
        result = result.replace(new RegExp((0, utils_1.escapeRegExp)(key) + '\\s*', 'g'), '');
    }
    return result.trim();
}
// ---------------------------------------------------------------------------
// Format helpers -- text messages
// ---------------------------------------------------------------------------
/**
 * Format a mention for a Feishu text / post message.
 * @returns e.g. `<at user_id="ou_xxx">Alice</at>`
 */
function formatMentionForText(target) {
    return `<at user_id="${target.openId}">${target.name}</at>`;
}
/** Format an @everyone mention for text / post. */
function formatMentionAllForText() {
    return `<at user_id="all">Everyone</at>`;
}
// ---------------------------------------------------------------------------
// Format helpers -- interactive card messages
// ---------------------------------------------------------------------------
/**
 * Format a mention for a Feishu Interactive Card.
 * @returns e.g. `<at id=ou_xxx></at>`
 */
function formatMentionForCard(target) {
    return `<at id=${target.openId}></at>`;
}
/** Format an @everyone mention for card. */
function formatMentionAllForCard() {
    return `<at id=all></at>`;
}
// ---------------------------------------------------------------------------
// Build helpers (prepend mentions to message body)
// ---------------------------------------------------------------------------
/** Prepend @mention tags (text format) to a message body. */
function buildMentionedMessage(targets, message) {
    if (targets.length === 0)
        return message;
    const mentionTags = targets.map(formatMentionForText).join(' ');
    return `${mentionTags}\n${message}`;
}
/** Prepend @mention tags (card format) to card markdown content. */
function buildMentionedCardContent(targets, message) {
    if (targets.length === 0)
        return message;
    const mentionTags = targets.map(formatMentionForCard).join(' ');
    return `${mentionTags}\n${message}`;
}
