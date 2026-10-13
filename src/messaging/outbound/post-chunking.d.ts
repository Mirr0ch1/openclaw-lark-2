/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Envelope-aware chunking for Feishu rich-post messages (ported from @openclaw/feishu).
 */
export declare const FEISHU_POST_MAX_BYTES: number;
/** Byte size of the exact post envelope `sendMessageFeishu` builds. */
export declare function postContentBytes(messageText: string): number;
export interface FeishuMarkdownChunkOptions {
    text: string;
    limit: number;
    mode?: string;
    initialChunks?: string[];
}
/** Split markdown so every chunk's serialized post envelope fits 30 KB. */
export declare function chunkFeishuMarkdownByEnvelope(params: FeishuMarkdownChunkOptions & {
    contentBytes: (text: string, isFirst: boolean) => number;
}): string[];
/** Convenience wrapper using the default post envelope for size measurement. */
export declare function chunkFeishuPostMarkdown(params: FeishuMarkdownChunkOptions): string[];
