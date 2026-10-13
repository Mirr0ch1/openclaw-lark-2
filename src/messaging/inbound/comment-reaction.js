"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Typing reaction on Feishu document comment threads.
 *
 * Ported from @openclaw/feishu `src/comment-reaction.ts`.
 *
 * When a comment (or reply) is addressed to the bot, a `Typing` reaction is
 * added to the reply so the author sees activity; it is removed once the agent
 * turn finishes. Comment events have no IM message to attach an IM typing
 * indicator to, which is why the plugin previously skipped typing entirely.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestCommentTypingReaction = requestCommentTypingReaction;
exports.cleanupAmbientCommentTypingReaction = cleanupAmbientCommentTypingReaction;
exports.createCommentTypingReactionLifecycle = createCommentTypingReactionLifecycle;
exports._resetCommentTypingReactionState = _resetCommentTypingReactionState;
const lark_client_1 = require("../../core/lark-client.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('inbound/comment-reaction');
const COMMENT_TYPING_REACTION_TYPE = 'Typing';
const COMMENT_REACTION_TIMEOUT_MS = 30 * 1000;
/**
 * Per-thread state so an add/cleanup pair runs at most once per reply. Mirrors
 * the official implementation: `cleanup` is idempotent and never deletes a
 * reaction that was not successfully added.
 */
const commentTypingReactionState = new Map();
function buildKey(params) {
    return `${params.fileType}:${params.fileToken}:${params.replyId}`;
}
function ensureState(key) {
    const existing = commentTypingReactionState.get(key);
    if (existing)
        return existing;
    const created = { active: false, cleaned: false, cleanupPromise: undefined };
    commentTypingReactionState.set(key, created);
    return created;
}
/** Test-only: drop all tracked typing-reaction state. */
function _resetCommentTypingReactionState() {
    commentTypingReactionState.clear();
}
/**
 * Add or remove the `Typing` reaction on a comment reply.
 * Returns `true` only when the API reported success.
 */
async function requestCommentTypingReaction(params) {
    try {
        const client = lark_client_1.LarkClient.fromCfg(params.cfg, params.accountId);
        const res = await client.sdk.request({
            method: 'POST',
            // The query is baked into the URL (as in the official plugin) rather
            // than passed via `params`, which this SDK's `request` does not send.
            url: `/open-apis/drive/v2/files/${encodeURIComponent(params.fileToken)}/comments/reaction` +
                `?file_type=${encodeURIComponent(params.fileType)}`,
            data: {
                action: params.action,
                reply_id: params.replyId,
                reaction_type: COMMENT_TYPING_REACTION_TYPE,
            },
            timeout: COMMENT_REACTION_TIMEOUT_MS,
        });
        if (res?.code === 0) {
            return true;
        }
        log.warn(`comment typing reaction ${params.action} failed ` +
            `reply=${params.replyId} file=${params.fileType}:${params.fileToken} ` +
            `code=${res?.code ?? 'unknown'} msg=${res?.msg ?? 'unknown'} ` +
            `log_id=${res?.log_id ?? res?.error?.log_id ?? 'unknown'}`);
    }
    catch (error) {
        log.warn(`comment typing reaction ${params.action} threw ` +
            `reply=${params.replyId} file=${params.fileType}:${params.fileToken} ` +
            `error=${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
}
/**
 * Remove a tracked typing reaction once. Safe to call repeatedly and from
 * multiple places; only the first successful delete clears `active`.
 */
async function cleanupCommentTypingReactionByKey(params) {
    const state = ensureState(params.key);
    if (state.cleaned) {
        return false;
    }
    if (state.cleanupPromise) {
        return await state.cleanupPromise;
    }
    const cleanupPromise = (async () => {
        if (!state.active) {
            state.cleaned = true;
            return false;
        }
        const deleted = await params.performDelete();
        if (deleted) {
            state.cleaned = true;
            state.active = false;
        }
        return deleted;
    })();
    state.cleanupPromise = cleanupPromise;
    try {
        return await cleanupPromise;
    }
    finally {
        state.cleanupPromise = undefined;
        if (state.cleaned) {
            state.active = false;
            commentTypingReactionState.delete(params.key);
        }
    }
}
/**
 * Remove any tracked typing reaction for a comment target (used by the comment
 * delivery path after a reply is posted).
 */
async function cleanupAmbientCommentTypingReaction(params) {
    const replyId = typeof params.replyId === 'string' ? params.replyId.trim() : '';
    if (!replyId || !params.fileToken)
        return false;
    const key = buildKey({
        fileToken: params.fileToken,
        fileType: params.fileType,
        replyId,
    });
    return cleanupCommentTypingReactionByKey({
        key,
        performDelete: () => requestCommentTypingReaction({
            cfg: params.cfg,
            accountId: params.accountId,
            fileToken: params.fileToken,
            fileType: params.fileType,
            replyId,
            action: 'delete',
        }),
    });
}
/**
 * Lifecycle for one comment event. `start()` adds the reaction (honouring the
 * account's `typingIndicator` setting); `cleanup()` removes it. When there is no
 * `replyId` — i.e. the event is not a reply — both are no-ops.
 */
function createCommentTypingReactionLifecycle(params) {
    const replyId = typeof params.replyId === 'string' ? params.replyId.trim() : '';
    const key = replyId
        ? buildKey({ fileToken: params.fileToken, fileType: params.fileType, replyId })
        : undefined;
    const state = key ? ensureState(key) : undefined;
    return {
        start: async () => {
            if (!state || !replyId || state.cleaned || state.active)
                return;
            if (!typingIndicatorEnabled(params.cfg, params.accountId))
                return;
            state.active = await requestCommentTypingReaction({
                cfg: params.cfg,
                accountId: params.accountId,
                fileToken: params.fileToken,
                fileType: params.fileType,
                replyId,
                action: 'add',
            });
        },
        cleanup: async () => {
            if (!key || !replyId)
                return;
            await cleanupCommentTypingReactionByKey({
                key,
                performDelete: () => requestCommentTypingReaction({
                    cfg: params.cfg,
                    accountId: params.accountId,
                    fileToken: params.fileToken,
                    fileType: params.fileType,
                    replyId,
                    action: 'delete',
                }),
            });
        },
    };
}
/** `channels.feishu.typingIndicator` defaults to true, matching official. */
function typingIndicatorEnabled(cfg, accountId) {
    try {
        const account = lark_client_1.LarkClient.fromCfg(cfg, accountId).account;
        return account.configured && (account.config.typingIndicator ?? true);
    }
    catch {
        return false;
    }
}
