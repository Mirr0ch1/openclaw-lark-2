/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Inbound message handling pipeline for the Lark/Feishu channel plugin.
 *
 * Orchestrates a nine-stage pipeline:
 *   1. Account resolution
 *   2. Event parsing         → parse.ts (merge_forward expanded in-place)
 *   3. Empty-message guard   → early return for text-less, media-less messages
 *   4. Sender enrichment     → enrich.ts (lightweight, before gate)
 *   5. Policy gate           → gate.ts
 *   6. User name prefetch    → enrich.ts (batch cache warm-up)
 *   7. Content resolution    → enrich.ts (media / quote, parallel)
 *   8. Command authorization → core/sdk-compat (ported from plugin-sdk/command-auth)
 *   9. Agent dispatch        → dispatch.ts
 */
import type { ClawdbotConfig, RuntimeEnv } from 'openclaw/plugin-sdk';
import type { HistoryEntry } from 'openclaw/plugin-sdk/reply-history';
import type { FeishuMessageEvent } from '../types';
export declare function handleFeishuMessage(params: {
    cfg: ClawdbotConfig;
    event: FeishuMessageEvent;
    botOpenId?: string;
    runtime?: RuntimeEnv;
    chatHistories?: Map<string, HistoryEntry[]>;
    accountId?: string;
    /** Override the message ID used for reply threading (typing indicators,
     *  card replies, etc.).  Useful for synthetic messages whose message_id
     *  is not a real Feishu message ID. */
    replyToMessageId?: string;
    /** When true, skip the policy gate (mention requirement, allowlist).
     *  Used for synthetic messages that are not real user messages. */
    forceMention?: boolean;
    /** When true, run the real access-control gate but treat the mention
     *  requirement as already satisfied. Used for card-action synthetic messages:
     *  the click is an explicit user action targeting the bot (implicit mention),
     *  but group/DM admission and sender allowlists must still be enforced.
     *  Takes precedence over forceMention. */
    cardActionGate?: boolean;
    /** When true, skip the typing indicator for this dispatch (e.g. reactions). */
    skipTyping?: boolean;
}): Promise<void>;
