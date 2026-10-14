"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu target ID parsing and formatting utilities.
 *
 * Feishu uses several namespaced identifier prefixes:
 *   - `oc_*`  -- chat (group / DM) IDs
 *   - `ou_*`  -- open user IDs
 *   - plain alphanumeric strings -- user IDs from the tenant directory
 *
 * This module provides helpers to detect, normalise, and format these IDs
 * for both internal routing and outbound Feishu API calls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIdType = detectIdType;
exports.stripFeishuProviderPrefix = stripFeishuProviderPrefix;
exports.normalizeFeishuTarget = normalizeFeishuTarget;
exports.parseFeishuRouteTarget = parseFeishuRouteTarget;
exports.encodeFeishuRouteTarget = encodeFeishuRouteTarget;
exports.formatFeishuTarget = formatFeishuTarget;
exports.resolveReceiveIdType = resolveReceiveIdType;
exports.normalizeMessageId = normalizeMessageId;
exports.looksLikeFeishuId = looksLikeFeishuId;
// ---------------------------------------------------------------------------
// Known prefix patterns
// ---------------------------------------------------------------------------
const CHAT_PREFIX = 'oc_';
const OPEN_ID_PREFIX = 'ou_';
// Canonical routing prefixes used inside OpenClaw (not Feishu-native).
const TAG_CHAT = 'chat:';
const TAG_USER = 'user:';
const TAG_OPEN_ID = 'open_id:';
const ROUTE_META_FRAGMENT_REPLY_TO = '__feishu_reply_to';
const ROUTE_META_FRAGMENT_THREAD_ID = '__feishu_thread_id';
// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
/**
 * Detect the Feishu ID type from a raw identifier string.
 *
 * Returns `null` when the string does not match any known pattern.
 */
function detectIdType(id) {
    if (!id)
        return null;
    if (id.startsWith(CHAT_PREFIX))
        return 'chat_id';
    if (id.startsWith(OPEN_ID_PREFIX))
        return 'open_id';
    // Plain alphanumeric strings (no prefix) are treated as tenant user IDs.
    if (/^[a-zA-Z0-9]+$/.test(id))
        return 'user_id';
    return null;
}
// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
/** Strip a leading `feishu:` / `lark:` provider tag. Mirrors @openclaw/feishu. */
function stripFeishuProviderPrefix(raw) {
    return typeof raw === 'string' ? raw.replace(/^(feishu|lark):/i, '').trim() : '';
}
/**
 * Strip the `feishu:`/`lark:` provider tag and one target-kind tag
 * (`chat:`, `group:`, `channel:`, `user:`, `dm:`, `open_id:`) from a raw target
 * string, returning the bare Feishu identifier.
 *
 * Returns `null` when the input is empty or falsy.
 */
function normalizeFeishuTarget(raw) {
    if (!raw)
        return null;
    const trimmed = parseFeishuRouteTarget(raw).target.trim();
    if (!trimmed)
        return null;
    // Strip the provider tag, then at most one target-kind tag — the same order
    // and tag set as @openclaw/feishu `normalizeFeishuTarget` (previously we
    // returned early on `feishu:` and lacked lark:/group:/channel:/dm:, which
    // left a tagged id in the target handed to the API).
    const withoutProvider = stripFeishuProviderPrefix(trimmed);
    if (!withoutProvider)
        return null;
    const prefix = /^(chat|group|channel|user|dm|open_id):/i.exec(withoutProvider);
    return prefix ? withoutProvider.slice(prefix[0].length).trim() || null : withoutProvider;
}
function parseFeishuRouteTarget(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return { target: '' };
    const hashIndex = trimmed.indexOf('#');
    if (hashIndex < 0)
        return { target: trimmed };
    const target = trimmed.slice(0, hashIndex).trim();
    const fragment = trimmed.slice(hashIndex + 1).trim();
    if (!fragment)
        return { target };
    const params = new URLSearchParams(fragment);
    const replyToMessageId = normalizeMessageId(params.get(ROUTE_META_FRAGMENT_REPLY_TO)?.trim() || undefined);
    const threadId = params.get(ROUTE_META_FRAGMENT_THREAD_ID)?.trim() || undefined;
    return {
        target,
        ...(replyToMessageId ? { replyToMessageId } : {}),
        ...(threadId ? { threadId } : {}),
    };
}
function encodeFeishuRouteTarget(params) {
    const target = params.target.trim();
    if (!target)
        return target;
    const replyToMessageId = normalizeMessageId(params.replyToMessageId?.trim() || undefined);
    const threadId = params.threadId != null && String(params.threadId).trim() !== '' ? String(params.threadId).trim() : undefined;
    if (!replyToMessageId && !threadId)
        return target;
    const fragment = new URLSearchParams();
    if (replyToMessageId)
        fragment.set(ROUTE_META_FRAGMENT_REPLY_TO, replyToMessageId);
    if (threadId)
        fragment.set(ROUTE_META_FRAGMENT_THREAD_ID, threadId);
    return `${target}#${fragment.toString()}`;
}
// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
/**
 * Add the appropriate OpenClaw routing prefix to a bare Feishu identifier.
 *
 * When `type` is omitted, the prefix is inferred via `detectIdType`.
 */
function formatFeishuTarget(id, type) {
    const resolved = type ?? detectIdType(id);
    if (resolved === 'chat_id')
        return `${TAG_CHAT}${id}`;
    return `${TAG_USER}${id}`;
}
// ---------------------------------------------------------------------------
// API receive-ID resolution
// ---------------------------------------------------------------------------
/**
 * Determine the `receive_id_type` query parameter for the Feishu send-message
 * API based on the target identifier.
 */
function resolveReceiveIdType(id) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    const lowered = trimmed.toLowerCase();
    // Target-kind tags may still be present: outbound send paths strip them via
    // normalizeFeishuTarget first, but the session-route contract hands us the
    // raw target. Mirrors @openclaw/feishu `resolveReceiveIdType` (which also
    // returns "user_id" for a bare tenant id; ours keeps the historical
    // "open_id" default to avoid changing unrelated outbound behaviour).
    if (lowered.startsWith('chat:') || lowered.startsWith('group:') || lowered.startsWith('channel:'))
        return 'chat_id';
    if (lowered.startsWith('open_id:') || lowered.startsWith('user:') || lowered.startsWith('dm:'))
        return 'open_id';
    if (trimmed.startsWith(CHAT_PREFIX))
        return 'chat_id';
    if (trimmed.startsWith(OPEN_ID_PREFIX))
        return 'open_id';
    return 'open_id';
}
function normalizeMessageId(messageId) {
    if (!messageId)
        return undefined;
    const colonIndex = messageId.indexOf(':');
    if (colonIndex >= 0)
        return messageId.slice(0, colonIndex);
    return messageId;
}
// ---------------------------------------------------------------------------
// Quick predicate
// ---------------------------------------------------------------------------
/**
 * Return `true` when a raw string looks like it could be a Feishu target
 * (either an OpenClaw-tagged form or a native prefix).
 */
function looksLikeFeishuId(raw) {
    if (!raw)
        return false;
    return (raw.startsWith(TAG_CHAT) ||
        raw.startsWith(TAG_USER) ||
        raw.startsWith(TAG_OPEN_ID) ||
        raw.startsWith(CHAT_PREFIX) ||
        raw.startsWith(OPEN_ID_PREFIX));
}
