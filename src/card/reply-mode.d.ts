/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pure functions for resolving the Feishu reply mode.
 *
 * Extracted from reply-dispatcher.ts to enable independent testing
 * and eliminate `as any` casts on FeishuConfig.
 */
import type { FeishuConfig } from '../core/types';
type ReplyModeValue = 'auto' | 'static' | 'streaming';
/** Canonical `streaming` config value (object) or the legacy boolean flag. */
export type FeishuStreamingConfig = boolean | {
    mode?: 'off' | 'partial';
    chunkMode?: 'length' | 'newline' | 'paragraph' | 'none';
    block?: {
        enabled?: boolean;
        coalesce?: {
            minChars?: number;
            maxChars?: number;
            idleMs?: number;
        };
    };
};
/**
 * Whether streaming-card replies are enabled by the `streaming` config value.
 *
 * `true` / a canonical object whose `mode` is not `"off"` enable streaming;
 * `false` and `{ mode: "off" }` disable it. An absent value stays disabled
 * (this plugin's default is static).
 */
export declare function isFeishuStreamingEnabled(streaming: FeishuStreamingConfig | undefined): boolean;
/**
 * Resolve the effective reply mode based on configuration and chat type.
 *
 * Priority: replyMode.{scene} > replyMode.default > replyMode (string) > "auto"
 */
export declare function resolveReplyMode(params: {
    feishuCfg: FeishuConfig | undefined;
    chatType?: 'p2p' | 'group';
}): ReplyModeValue;
/**
 * Expand "auto" mode to a concrete mode based on streaming flag and chat type.
 *
 * When streaming is enabled: group → static, direct → streaming (legacy behavior).
 * When streaming is not enabled: always static.
 */
export declare function expandAutoMode(params: {
    mode: ReplyModeValue;
    streaming: FeishuStreamingConfig | undefined;
    chatType?: 'p2p' | 'group';
}): 'static' | 'streaming';
/**
 * scope A: rich text now renders natively as post(`tag:md`); we never force a
 * card for code blocks OR tables anymore. Native rendering also keeps bot-at-bot
 * @ delivery working — wrapping a reply in a card breaks it (cards have limited
 * @ support). The only remaining card-path guard is the table-count hard limit,
 * retained for the runtime fallback in reply-dispatcher (card rejected by
 * Feishu → plain text).
 */
export declare function shouldUseCard(text: string): boolean;
export {};
