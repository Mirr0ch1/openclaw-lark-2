"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Inbound debounce merge.
 *
 * Ported from @openclaw/feishu `src/monitor.message-handler.ts`.
 *
 * When a user fires several short text messages in quick succession, the
 * debouncer buffers them per `(account, chat, thread, sender)` and — after a
 * quiet period — merges them into ONE synthetic message so a single agent turn
 * answers the whole burst (instead of one reply per message).
 *
 * Opt-in via core config `messages.inbound.debounceMs` (default 0 = off); a
 * value of 0 makes `shouldBuffer` always false, so the direct path is used and
 * behavior is unchanged.
 *
 * The merge preserves the dedupe/replay semantics: every buffered message's
 * logical claim is settled (suppressed ones committed, the dispatched one
 * committed after adoption) so no message is reprocessed and none is lost.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDebounceText = extractDebounceText;
exports.mergeFeishuDebounceMentions = mergeFeishuDebounceMentions;
exports.isMentionForwardRequest = isMentionForwardRequest;
exports.resolveFeishuDebounceMentions = resolveFeishuDebounceMentions;
exports.dedupeFeishuDebounceEntriesByDedupeKey = dedupeFeishuDebounceEntriesByDedupeKey;
exports.createFeishuInboundDebouncer = createFeishuInboundDebouncer;
const channel_inbound_debounce_1 = require("openclaw/plugin-sdk/channel-inbound-debounce");
const dedupe_key_1 = require("./dedupe-key.js");
const ingress_lifecycle_1 = require("../../channel/ingress-lifecycle.js");
// ---------------------------------------------------------------------------
// Text extraction (synchronous — the debouncer needs it before async parsing)
// ---------------------------------------------------------------------------
/**
 * Extract the human-readable text of a text message, substituting mention
 * placeholders (`@_user_N`) with `@Name`.
 *
 * The bot's OWN mention is removed entirely (mirroring the official
 * `normalizeMentions`): otherwise an `@bot /command` would not be recognised as
 * a control command by `isControlCommandMessage` and would be wrongly buffered.
 *
 * Returns `''` for non-text or unparseable messages. Synchronous by design —
 * `shouldDebounce`/merge run outside the async parse pipeline.
 */
function extractDebounceText(event, botOpenId) {
    if (!event || event.message?.message_type !== 'text') {
        return '';
    }
    let text;
    try {
        text = JSON.parse(event.message.content)?.text;
    }
    catch {
        return '';
    }
    if (typeof text !== 'string') {
        return '';
    }
    const normalizedBot = typeof botOpenId === 'string' ? botOpenId.trim() : '';
    for (const mention of event.message.mentions ?? []) {
        const key = mention?.key;
        if (!key)
            continue;
        const openId = mention?.id?.open_id ?? '';
        const isBot = Boolean(normalizedBot) && openId === normalizedBot;
        const name = typeof mention?.name === 'string' ? mention.name.trim() : '';
        text = text.split(key).join(isBot ? '' : name ? `@${name}` : '');
    }
    // Strip any leftover unmatched placeholders.
    return text.replace(/@_user_\d+/g, '').trim();
}
// ---------------------------------------------------------------------------
// Mention merging
// ---------------------------------------------------------------------------
/** Whether a raw mention entry represents @all / @所有人 (a broadcast). */
function isBroadcastMention(mention) {
    const key = mention?.key?.trim().toLowerCase();
    if (key === '@all' || key === '@_all')
        return true;
    const ids = [mention?.id?.open_id, mention?.id?.user_id, mention?.id?.union_id];
    return ids.some((id) => typeof id === 'string' && id.trim().toLowerCase() === 'all');
}
function isGroupChatType(chatType) {
    return chatType === 'group' || chatType === 'topic_group';
}
/**
 * Whether the message is a "mention forward" request: in a group, the bot plus
 * at least one other user are mentioned; in a DM, any user is mentioned.
 * Ported from @openclaw/feishu `mention.ts` `isMentionForwardRequest`.
 */
function isMentionForwardRequest(event, botOpenId) {
    const mentions = event?.message?.mentions ?? [];
    if (mentions.length === 0)
        return false;
    const normalizedBot = typeof botOpenId === 'string' ? botOpenId.trim() : '';
    if (!normalizedBot)
        return false;
    const userMentions = mentions.filter((m) => !isBroadcastMention(m));
    const hasOther = userMentions.some((m) => m?.id?.open_id !== normalizedBot);
    if (!isGroupChatType(event?.message?.chat_type)) {
        return hasOther;
    }
    const hasBot = userMentions.some((m) => m?.id?.open_id === normalizedBot);
    return hasBot && hasOther;
}
/** Union of mentions across events, de-duplicated by stable id (or name|key). */
function mergeFeishuDebounceMentions(events) {
    const merged = new Map();
    for (const event of events) {
        for (const mention of event?.message?.mentions ?? []) {
            const stableId = mention?.id?.open_id?.trim() || mention?.id?.user_id?.trim() || mention?.id?.union_id?.trim();
            const name = mention?.name?.trim();
            const key = mention?.key?.trim();
            const fallback = name && key ? `${name}|${key}` : name || key;
            const id = stableId || fallback;
            if (!id || merged.has(id))
                continue;
            merged.set(id, mention);
        }
    }
    return merged.size > 0 ? Array.from(merged.values()) : undefined;
}
/**
 * Resolve the merged `mentions` array for a debounced flush.
 *
 * If the most recent entry is a mention-forward request, use only that entry's
 * mentions (forwarding targets those users); otherwise merge all and keep only
 * the bot's mentions so downstream mention gating still sees the bot.
 */
function resolveFeishuDebounceMentions(params) {
    const { entries, botOpenId } = params;
    if (!entries || entries.length === 0)
        return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (isMentionForwardRequest(entries[i], botOpenId)) {
            return mergeFeishuDebounceMentions([entries[i]]);
        }
    }
    const merged = mergeFeishuDebounceMentions(entries);
    if (!merged)
        return undefined;
    const normalizedBot = typeof botOpenId === 'string' ? botOpenId.trim() : '';
    if (!normalizedBot)
        return undefined;
    const botMentions = merged.filter((m) => m?.id?.open_id?.trim() === normalizedBot);
    return botMentions.length > 0 ? botMentions : undefined;
}
/** Drop entries whose logical dedupe key repeats, keeping the first. */
function dedupeFeishuDebounceEntriesByDedupeKey(entries) {
    const seen = new Set();
    const deduped = [];
    for (const entry of entries) {
        const dedupeKey = (0, dedupe_key_1.resolveFeishuMessageDedupeKey)(entry.event);
        if (!dedupeKey) {
            deduped.push(entry);
            continue;
        }
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        deduped.push(entry);
    }
    return deduped;
}
// ---------------------------------------------------------------------------
// Debouncer factory
// ---------------------------------------------------------------------------
/**
 * Create the per-account inbound debouncer.
 *
 * @param params.dispatch  Enqueue + handle a (possibly merged) event. Receives
 *   `(event, dedupeKey, processingClaim, admissionLifecycle)`.
 * @param params.getBotOpenId  Resolve the bot open_id for mention handling.
 * @param params.hasProcessed  `(dedupeKey, namespace, log) => Promise<boolean>`
 *   — used to drop already-handled entries during a merge.
 */
function createFeishuInboundDebouncer(params) {
    const { accountId, debounceMs, dispatch, getBotOpenId, hasProcessed, log, error } = params;
    const resolveText = (event) => (params.resolveDebounceText ?? extractDebounceText)(event, getBotOpenId?.());
    const recordSuppressedMessageIds = async (entries, dispatchDedupeKey, skipDurable) => {
        const keep = typeof dispatchDedupeKey === 'string' ? dispatchDedupeKey.trim() : undefined;
        const seen = new Set();
        for (const entry of entries) {
            // A durable fan-in lifecycle commits the durable sources' claims
            // after adoption; skip those here to preserve commit-after-adoption.
            // Non-durable claims are never covered by the fan-in, so always
            // settle them to avoid an in-flight leak.
            if (skipDurable && entry.turnAdoptionLifecycle)
                continue;
            const id = (0, dedupe_key_1.resolveFeishuMessageDedupeKey)(entry.event);
            if (!id || (keep && id === keep) || seen.has(id))
                continue;
            seen.add(id);
            try {
                await entry.processingClaim?.commit();
            }
            catch (err) {
                error(`feishu[${accountId}]: failed to record merged dedupe id ${id}: ${String(err)}`);
            }
        }
    };
    return (0, channel_inbound_debounce_1.createInboundDebouncer)({
        debounceMs,
        buildKey: ({ event }) => {
            const chatId = event?.message?.chat_id?.trim();
            const senderId = event?.sender?.sender_id?.open_id?.trim() || event?.sender?.sender_id?.user_id?.trim();
            if (!chatId || !senderId)
                return null;
            const threadId = event?.message?.root_id?.trim() || event?.message?.thread_id?.trim();
            const threadKey = threadId ? `thread:${threadId}` : 'chat';
            return `feishu:${accountId}:${chatId}:${threadKey}:${senderId}`;
        },
        shouldDebounce: ({ event }) => {
            if (event?.message?.message_type !== 'text')
                return false;
            const text = resolveText(event);
            return Boolean(text) && !params.isControlCommand?.(text);
        },
        onFlush: (entries, createFlush) => {
            const activeEntries = entries.filter((entry) => !entry.abandoned);
            const last = activeEntries.at(-1);
            const { lifecycle, settle } = (0, ingress_lifecycle_1.buildFlushIngressLifecycle)(activeEntries.map((entry) => ({
                lifecycle: entry.turnAdoptionLifecycle,
                replayClaim: entry.processingClaim,
            })), {
                onReplayCommitError: (err) => error(`feishu[${accountId}]: failed to commit logical replay guard: ${String(err)}`),
            });
            return createFlush({
                lifecycle,
                dispatch: async (admissionLifecycle) => {
                    if (!last)
                        return;
                    if (admissionLifecycle.abortSignal.aborted) {
                        await admissionLifecycle.onAbandoned();
                        return;
                    }
                    try {
                        if (activeEntries.length === 1) {
                            await dispatch(last.event, (0, dedupe_key_1.resolveFeishuMessageDedupeKey)(last.event), last.processingClaim, admissionLifecycle);
                            await settle();
                            return;
                        }
                        const dedupedEntries = dedupeFeishuDebounceEntriesByDedupeKey(activeEntries);
                        const freshEntries = [];
                        for (const entry of dedupedEntries) {
                            if (!(await hasProcessed((0, dedupe_key_1.resolveFeishuMessageDedupeKey)(entry.event), accountId, log))) {
                                freshEntries.push(entry);
                            }
                        }
                        const dispatchEntry = freshEntries.at(-1);
                        if (!dispatchEntry) {
                            // Nothing to dispatch — settle every buffered claim so
                            // none leaks. Durable claims are settled by the fan-in
                            // `settle()`; non-durable claims (which `settle` does
                            // not touch) are committed here.
                            await recordSuppressedMessageIds(dedupedEntries, undefined, Boolean(lifecycle));
                            await settle();
                            return;
                        }
                        const dispatchDedupeKey = (0, dedupe_key_1.resolveFeishuMessageDedupeKey)(dispatchEntry.event);
                        await recordSuppressedMessageIds(dedupedEntries, dispatchDedupeKey, Boolean(lifecycle));
                        const combinedText = freshEntries
                            .map((entry) => resolveText(entry.event))
                            .filter(Boolean)
                            .join('\n');
                        const mergedMentions = resolveFeishuDebounceMentions({
                            entries: freshEntries.map((entry) => entry.event),
                            botOpenId: getBotOpenId?.(),
                        });
                        await dispatch({
                            ...dispatchEntry.event,
                            message: {
                                ...dispatchEntry.event.message,
                                ...(combinedText.trim()
                                    ? {
                                        message_type: 'text',
                                        content: JSON.stringify({ text: combinedText }),
                                    }
                                    : {}),
                                mentions: mergedMentions ?? dispatchEntry.event.message.mentions,
                            },
                        }, dispatchDedupeKey, dispatchEntry.processingClaim, admissionLifecycle);
                        await settle();
                    }
                    catch (err) {
                        await admissionLifecycle.onAbandoned();
                        throw err;
                    }
                },
            });
        },
        onError: (err, entries) => {
            for (const entry of entries) {
                entry.processingClaim?.release({ error: err });
                try {
                    void Promise.resolve(entry.turnAdoptionLifecycle?.onAbandoned()).catch((abandonError) => {
                        error(`feishu[${accountId}]: failed to abandon durable ingress after debounce error: ${String(abandonError)}`);
                    });
                }
                catch (abandonError) {
                    error(`feishu[${accountId}]: failed to abandon durable ingress after debounce error: ${String(abandonError)}`);
                }
            }
            error(`feishu[${accountId}]: inbound debounce flush failed: ${String(err)}`);
        },
    });
}
