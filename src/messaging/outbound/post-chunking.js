"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Envelope-aware chunking for Feishu rich-post messages.
 *
 * Ported from @openclaw/feishu `src/markdown.ts`.
 *
 * Character-based chunking is not enough: Feishu rejects a `post` whose
 * *serialized* JSON exceeds 30 KB. Because the payload is UTF-8 JSON wrapped
 * in `{ zh_cn: { content: [[{ tag: "md", text }]] } }`, multi-byte characters
 * and JSON escaping push the real byte count well above the character count
 * (a 15 000-char CJK chunk is already ~45 KB). This measures the actual
 * transport envelope and shrinks a chunk until it fits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEISHU_POST_MAX_BYTES = void 0;
exports.postContentBytes = postContentBytes;
exports.chunkFeishuMarkdownByEnvelope = chunkFeishuMarkdownByEnvelope;
exports.chunkFeishuPostMarkdown = chunkFeishuPostMarkdown;
const reply_chunking_1 = require("openclaw/plugin-sdk/reply-chunking");
/** Feishu rejects a rich post whose serialized JSON exceeds 30 KB. */
const FEISHU_POST_MAX_BYTES = 30 * 1024;
exports.FEISHU_POST_MAX_BYTES = FEISHU_POST_MAX_BYTES;
/**
 * Headroom reserved on the first chunk. The first chunk can grow *after* it
 * is measured here: outbound mention injection prepends `<at user_id=…>` and
 * markdown-style optimisation may grow text (heading demotion, `<br>`
 * spacing). Reserving a small budget keeps a near-limit first chunk from
 * serializing over 30 KB.
 */
const FIRST_CHUNK_HEADROOM_BYTES = 1024;
/** Byte size of the exact post envelope `sendMessageFeishu` builds. */
function postContentBytes(messageText) {
    return Buffer.byteLength(JSON.stringify({
        zh_cn: {
            content: [[{ tag: 'md', text: messageText }]],
        },
    }), 'utf8');
}
/**
 * Split markdown so every chunk's *serialized post envelope* fits the 30 KB
 * API limit, while still honouring the configured character limit.
 */
function chunkFeishuMarkdownByEnvelope(params) {
    const { text } = params;
    if (!text)
        return [];
    const requestedLimit = Number.isFinite(params.limit) && params.limit > 0 ? Math.floor(params.limit) : text.length;
    const mode = params.mode ?? 'length';
    const initialChunks = params.initialChunks ?? (0, reply_chunking_1.chunkMarkdownTextWithMode)(text, requestedLimit, mode);
    const output = [];
    for (const initialChunk of initialChunks) {
        const isFirst = output.length === 0;
        const budgetBytes = isFirst ? FEISHU_POST_MAX_BYTES - FIRST_CHUNK_HEADROOM_BYTES : FEISHU_POST_MAX_BYTES;
        if (params.contentBytes(initialChunk, isFirst) <= budgetBytes) {
            output.push(initialChunk);
            continue;
        }
        let adaptiveLimit = Math.max(1, Math.min(requestedLimit, initialChunk.length));
        for (;;) {
            const chunks = (0, reply_chunking_1.chunkMarkdownTextWithMode)(initialChunk, adaptiveLimit, mode);
            let largestContentBytes = 0;
            let oversizedChunk;
            for (const [index, chunk] of chunks.entries()) {
                const contentBytes = params.contentBytes(chunk, isFirst && index === 0);
                largestContentBytes = Math.max(largestContentBytes, contentBytes);
                if (contentBytes > budgetBytes && oversizedChunk === undefined) {
                    oversizedChunk = chunk;
                }
            }
            if (oversizedChunk === undefined) {
                output.push(...chunks);
                break;
            }
            if (adaptiveLimit === 1) {
                throw new Error('Feishu Markdown chunk exceeds the 30 KB rich-post API limit');
            }
            // Scale by observed serialized size, then force progress for envelope
            // overhead or Markdown fences that do not shrink with source text.
            adaptiveLimit = Math.max(1, Math.min(adaptiveLimit - 1, Math.floor((adaptiveLimit * budgetBytes) / largestContentBytes) - 1));
        }
    }
    return output;
}
/** Convenience wrapper using the default post envelope for size measurement. */
function chunkFeishuPostMarkdown(params) {
    return chunkFeishuMarkdownByEnvelope({
        ...params,
        contentBytes: (chunk) => postContentBytes(chunk),
    });
}
