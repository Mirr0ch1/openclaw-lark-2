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
/** Max consecutive bot-originated turns before auto-reply is suppressed. */
export declare const MAX_CONSECUTIVE_BOT_TURNS = 10;
/** Idle window after which a conversation's counter is considered stale. */
export declare const BOT_LOOP_IDLE_RESET_MS: number;
export interface BotTurnVerdict {
    /** False once the consecutive bot-turn count exceeds the cap. */
    allowed: boolean;
    /** The current consecutive bot-turn count after this turn. */
    count: number;
    /** The configured cap, for logging. */
    limit: number;
}
/**
 * Record one bot-originated turn for the given conversation and decide
 * whether the bot should still auto-reply.
 *
 * Increments the consecutive-bot-turn counter (resetting first if the
 * conversation has been idle past the decay window), then returns
 * `allowed: false` once the count exceeds {@link MAX_CONSECUTIVE_BOT_TURNS}.
 */
export declare function noteBotTurnAndCheck(chatId: string, threadId?: string, now?: number): BotTurnVerdict;
/**
 * Reset the consecutive bot-turn counter for a conversation. Called on every
 * human turn so a human stepping in always re-arms the debate budget.
 */
export declare function resetBotLoop(chatId: string, threadId?: string): void;
/** Clear all loop state. Intended for tests. */
/** Number of tracked conversations. Intended for tests. */
