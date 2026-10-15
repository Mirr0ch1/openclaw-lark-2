"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Cross-bot loop guard for bot-at-bot (ping-pong) conversations.
 *
 * Background: when two different bots @-mention each other in a group, each
 * reply wakes the other, which replies again — an endless debate. The
 * existing self-echo filter only drops a bot's *own* echo; it does nothing
 * for A↔B loops. This module adds a deterministic hard brake: count the
 * consecutive turns whose sender is a bot per (chat, thread), and stop
 * auto-replying once the count exceeds a cap. Any human turn resets the
 * counter, so a new human-driven exchange starts fresh.
 *
 * State is process-local and best-effort (each bot process keeps its own
 * counter for the peer's messages it receives). Idle conversations decay so
 * a long-quiet chat doesn't carry a stale count into a new exchange.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_LOOP_IDLE_RESET_MS = exports.MAX_CONSECUTIVE_BOT_TURNS = void 0;
exports.noteBotTurnAndCheck = noteBotTurnAndCheck;
exports.resetBotLoop = resetBotLoop;
/** Max consecutive bot-originated turns before auto-reply is suppressed. */
exports.MAX_CONSECUTIVE_BOT_TURNS = 10;
/** Idle window after which a conversation's counter is considered stale. */
exports.BOT_LOOP_IDLE_RESET_MS = 10 * 60 * 1000; // 10 min
// `${chatId}:${threadId ?? ''}` -> consecutive bot-turn state
const states = new Map();
// Timestamp of the last stale-entry sweep, to bound sweep frequency.
let lastSweepAt = 0;
function loopKey(chatId, threadId) {
    return `${chatId}:${threadId ?? ''}`;
}
/**
 * Evict entries idle past the decay window. Called opportunistically from
 * noteBotTurnAndCheck (at most once per idle window) so the Map can't grow
 * unbounded for bot-only chats that never see a human turn to reset them.
 * Dropping a stale entry is equivalent to leaving it: the next access would
 * reset its count to 1 via the freshness check anyway.
 */
function sweepStale(now) {
    if (now - lastSweepAt < exports.BOT_LOOP_IDLE_RESET_MS)
        return;
    lastSweepAt = now;
    for (const [key, state] of states) {
        if (now - state.updatedAt > exports.BOT_LOOP_IDLE_RESET_MS)
            states.delete(key);
    }
}
/**
 * Record one bot-originated turn for the given conversation and decide
 * whether the bot should still auto-reply.
 *
 * Increments the consecutive-bot-turn counter (resetting first if the
 * conversation has been idle past the decay window), then returns
 * `allowed: false` once the count exceeds {@link MAX_CONSECUTIVE_BOT_TURNS}.
 */
function noteBotTurnAndCheck(chatId, threadId, now = Date.now()) {
    sweepStale(now);
    const key = loopKey(chatId, threadId);
    const prev = states.get(key);
    const fresh = prev && now - prev.updatedAt <= exports.BOT_LOOP_IDLE_RESET_MS;
    const count = (fresh ? prev.count : 0) + 1;
    states.set(key, { count, updatedAt: now });
    return {
        allowed: count <= exports.MAX_CONSECUTIVE_BOT_TURNS,
        count,
        limit: exports.MAX_CONSECUTIVE_BOT_TURNS,
    };
}
/**
 * Reset the consecutive bot-turn counter for a conversation. Called on every
 * human turn so a human stepping in always re-arms the debate budget.
 */
function resetBotLoop(chatId, threadId) {
    states.delete(loopKey(chatId, threadId));
}
/** Clear all loop state. Intended for tests. */
/** Number of tracked conversations. Intended for tests. */
