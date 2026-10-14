"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Media handling for the Lark/Feishu channel plugin.
 *
 * Provides functions for downloading images and file resources from
 * Feishu messages, uploading media to the Feishu IM storage, and
 * sending image / file messages to chats.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadMessageResourceFeishu = downloadMessageResourceFeishu;
exports.uploadImageLark = uploadImageLark;
exports.uploadFileLark = uploadFileLark;
exports.sendImageLark = sendImageLark;
exports.sendFileLark = sendFileLark;
exports.sendVideoLark = sendVideoLark;
exports.sendAudioLark = sendAudioLark;
exports.detectFileType = detectFileType;
exports.parseOggOpusDuration = parseOggOpusDuration;
exports.parseMp4Duration = parseMp4Duration;
exports.uploadAndSendMediaLark = uploadAndSendMediaLark;
exports.fetchRemoteImageBuffer = fetchRemoteImageBuffer;
exports.isImageMediaUrl = isImageMediaUrl;
exports.uploadImageFromUrlLark = uploadImageFromUrlLark;
exports.resolveOutboundMediaMaxBytes = resolveOutboundMediaMaxBytes;
exports.readResponseBodyWithCap = readResponseBodyWithCap;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_stream_1 = require("node:stream");
const lark_client_1 = require("../../core/lark-client.js");
const ssrf_1 = require("../../core/ssrf.js");
const targets_1 = require("../../core/targets.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const accounts_1 = require("../../core/accounts.js");
const send_rate_limit_1 = require("./send-rate-limit.js");
const media_url_utils_1 = require("./media-url-utils.js");
const log = (0, lark_logger_1.larkLogger)('outbound/media');
// ---------------------------------------------------------------------------
// Media size limits
// ---------------------------------------------------------------------------
/**
 * Hard ceiling for outbound media uploads, mirroring the official plugin's
 * `FEISHU_MAX_FILE_UPLOAD_BYTES`. Feishu rejects larger uploads anyway; the
 * cap lets us fail fast (and bound memory) before buffering the whole file.
 */
const FEISHU_MAX_FILE_UPLOAD_BYTES = 30 * 1024 * 1024;
exports.FEISHU_MAX_FILE_UPLOAD_BYTES = FEISHU_MAX_FILE_UPLOAD_BYTES;
/**
 * Resolve the outbound media size cap for an account.
 *
 * Effective limit = min(configured `mediaMaxMb` (default 30MB), the hard
 * Feishu upload ceiling). Mirrors `media.ts` `mediaMaxBytes`.
 */
function resolveOutboundMediaMaxBytes(cfg, accountId) {
    let configuredMb = 30;
    try {
        const account = (0, accounts_1.getLarkAccount)(cfg, accountId ?? undefined);
        const mb = account?.config?.mediaMaxMb;
        // Guard against a non-positive / non-finite value (a typo would
        // otherwise produce a 0-byte cap and silently disable all media sends).
        if (typeof mb === 'number' && Number.isFinite(mb) && mb > 0) {
            configuredMb = mb;
        }
    }
    catch {
        // Account resolution is best-effort; fall back to the default cap.
    }
    return Math.min(configuredMb * 1024 * 1024, FEISHU_MAX_FILE_UPLOAD_BYTES);
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}
/**
 * Read a fetch Response body into a Buffer, aborting as soon as the running
 * total exceeds `maxBytes`. Prefers a streaming read (bounds peak memory to
 * the cap plus one chunk); falls back to a whole-body read when the runtime
 * does not expose a readable body stream.
 */
async function readResponseBodyWithCap(response, maxBytes, url) {
    const tooLarge = () => new Error(`[feishu-media] Media at "${url}" exceeds the ${formatBytes(maxBytes)} upload limit. ` +
        `Increase channels.feishu.mediaMaxMb (max ${formatBytes(FEISHU_MAX_FILE_UPLOAD_BYTES)}) or send a smaller file.`);
    // Prefer Content-Length when the server declares it.
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw tooLarge();
    }
    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes)
            throw tooLarge();
        return Buffer.from(arrayBuffer);
    }
    const reader = body.getReader();
    const chunks = [];
    let received = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            received += value.byteLength;
            if (received > maxBytes) {
                // Cancel the stream, but never let a cancel failure mask the
                // size-limit error the caller needs to see.
                try {
                    await reader.cancel();
                }
                catch {
                    // Ignore — the size error below is the actionable one.
                }
                throw tooLarge();
            }
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        try {
            reader.releaseLock?.();
        }
        catch {
            // Ignore release errors.
        }
    }
    return Buffer.concat(chunks);
}
// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------
/** HTTP status codes that are safe to retry (transient server errors). */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
/** Maximum number of retry attempts for transient failures. */
const MEDIA_RETRY_MAX = 2;
/** Base delay (ms) between retries — actual delay = base * attempt. */
const MEDIA_RETRY_DELAY_MS = 1000;
/**
 * Run an async operation with bounded retries for transient HTTP errors.
 *
 * Only retries when the error carries a recognised retryable HTTP status
 * code. All other errors are thrown immediately.
 */
async function withRetry(fn, label, maxRetries = MEDIA_RETRY_MAX) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const status = extractHttpStatus(err);
            if (status == null || !RETRYABLE_STATUS_CODES.has(status) || attempt >= maxRetries) {
                throw err;
            }
            const delay = MEDIA_RETRY_DELAY_MS * (attempt + 1);
            log.warn(`${label}: HTTP ${status}, retrying (${attempt + 1}/${maxRetries}) after ${delay}ms`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
/**
 * Best-effort extraction of an HTTP status code from an unknown error.
 * Returns `undefined` when the error does not carry status information.
 */
function extractHttpStatus(err) {
    if (err != null && typeof err === 'object') {
        const obj = err;
        if (typeof obj.status === 'number')
            return obj.status;
        if (typeof obj.statusCode === 'number')
            return obj.statusCode;
        // Some SDK wrappers embed status in the message string.
        if (typeof obj.message === 'string') {
            const m = obj.message.match(/\b(50[2-4])\b/);
            if (m)
                return Number(m[1]);
        }
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Response extraction helpers
// ---------------------------------------------------------------------------
/**
 * Extract a Buffer from various SDK response formats.
 *
 * The Feishu Node SDK can return binary data in several shapes depending
 * on the runtime environment and SDK version:
 *   - A Buffer directly
 *   - An ArrayBuffer
 *   - A response object with a `.data` property
 *   - A response object with `.getReadableStream()`
 *   - A response object with `.writeFile(path)`
 *   - An async iterable / iterator
 *   - A Node.js Readable stream
 *
 * This helper normalises all of those into a single Buffer.
 */
async function extractBufferFromResponse(response) {
    // Direct Buffer
    if (Buffer.isBuffer(response)) {
        return { buffer: response };
    }
    // ArrayBuffer
    if (response instanceof ArrayBuffer) {
        return { buffer: Buffer.from(response) };
    }
    // Null / undefined guard
    if (response == null) {
        throw new Error('[feishu-media] Received null/undefined response');
    }
    const resp = response;
    const contentType = resp.headers?.['content-type'] ?? resp.contentType ?? undefined;
    // Response with .data as Buffer or ArrayBuffer
    if (resp.data != null) {
        if (Buffer.isBuffer(resp.data)) {
            return { buffer: resp.data, contentType };
        }
        if (resp.data instanceof ArrayBuffer) {
            return { buffer: Buffer.from(resp.data), contentType };
        }
        // .data might itself be a readable stream
        if (typeof resp.data.pipe === 'function') {
            const buf = await streamToBuffer(resp.data);
            return { buffer: buf, contentType };
        }
    }
    // Response with .getReadableStream()
    if (typeof resp.getReadableStream === 'function') {
        const stream = await resp.getReadableStream();
        const buf = await streamToBuffer(stream);
        return { buffer: buf, contentType };
    }
    // Response with .writeFile(path) -- write to a temp file and read back.
    if (typeof resp.writeFile === 'function') {
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `feishu-media-${Date.now()}`);
        try {
            await resp.writeFile(tmpFile);
            const buf = fs.readFileSync(tmpFile);
            return { buffer: buf, contentType };
        }
        finally {
            // Clean up the temp file.
            try {
                fs.unlinkSync(tmpFile);
            }
            catch {
                // Ignore cleanup errors.
            }
        }
    }
    // Async iterable / iterator (e.g. response body chunks)
    if (typeof resp[Symbol.asyncIterator] === 'function' || typeof resp.next === 'function') {
        const chunks = [];
        const iterable = typeof resp[Symbol.asyncIterator] === 'function'
            ? resp
            : asyncIteratorToIterable(resp);
        for await (const chunk of iterable) {
            chunks.push(Buffer.from(chunk));
        }
        return { buffer: Buffer.concat(chunks), contentType };
    }
    // Node.js Readable stream
    if (typeof resp.pipe === 'function') {
        const buf = await streamToBuffer(resp);
        return { buffer: buf, contentType };
    }
    throw new Error('[feishu-media] Unable to extract binary data from response: unrecognised format');
}
/**
 * Consume a Readable stream into a Buffer.
 */
function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => {
            chunks.push(Buffer.from(chunk));
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}
/**
 * Wrap an AsyncIterator into an AsyncIterable.
 */
async function* asyncIteratorToIterable(iterator) {
    while (true) {
        const { value, done } = await iterator.next();
        if (done)
            break;
        yield value;
    }
}
// ---------------------------------------------------------------------------
// downloadMessageResourceFeishu
// ---------------------------------------------------------------------------
/**
 * Download a resource (image or file) attached to a specific message.
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.messageId - The message the resource belongs to.
 * @param params.fileKey   - The file_key or image_key of the resource.
 * @param params.type      - Whether the resource is an "image" or "file".
 * @param params.accountId - Optional account identifier.
 * @returns The resource buffer, content type, and file name.
 */
async function downloadMessageResourceFeishu(params) {
    const { cfg, messageId, fileKey, type, accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const response = await withRetry(() => client.im.messageResource.get({
        path: {
            message_id: messageId,
            file_key: fileKey,
        },
        params: {
            type,
        },
    }), `downloadMessageResource(${fileKey})`);
    const { buffer, contentType } = await extractBufferFromResponse(response);
    // Attempt to extract file name from response headers.
    let fileName;
    if (response && typeof response === 'object') {
        const resp = response;
        const disposition = resp.headers?.['content-disposition'] ?? resp.headers?.['Content-Disposition'];
        if (typeof disposition === 'string') {
            const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';\n]+)/i);
            if (match) {
                fileName = decodeURIComponent(match[1].trim());
            }
        }
    }
    return { buffer, contentType, fileName };
}
// ---------------------------------------------------------------------------
// uploadImageLark
// ---------------------------------------------------------------------------
/**
 * Upload an image to Feishu IM storage.
 *
 * Accepts either a Buffer containing the raw image bytes or a file
 * system path to read from.
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.image     - A Buffer or local file path for the image.
 * @param params.imageType - The image usage type: "message" (default) or "avatar".
 * @param params.accountId - Optional account identifier.
 * @returns The assigned image_key.
 */
async function uploadImageLark(params) {
    const { cfg, image, imageType = 'message', accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const imageStream = Buffer.isBuffer(image) ? node_stream_1.Readable.from(image) : fs.createReadStream(image);
    const response = await client.im.image.create({
        data: { image_type: imageType, image: imageStream },
    });
    const imageKey = response?.data?.image_key ?? response?.image_key;
    if (!imageKey) {
        throw new Error('[feishu-media] Image upload failed: no image_key in response. ' +
            `Check that the image is a valid format (JPEG/PNG/GIF/BMP/WEBP). ` +
            `Response: ${JSON.stringify(response).slice(0, 200)}`);
    }
    return { imageKey };
}
// ---------------------------------------------------------------------------
// Multi-image post helpers (single rich-text post path)
// ---------------------------------------------------------------------------
/**
 * Check whether a media URL points at an image (by file extension).
 *
 * Local paths and remote URLs are both resolved to a file name via
 * `resolveFileNameFromMediaUrl`, then checked against the known image
 * extension set. URLs whose path carries no image extension (e.g. signed
 * download URLs) resolve to `false`, so callers can safely fall back to
 * per-media sends instead of mis-routing a video or document.
 */
function isImageMediaUrl(mediaUrl) {
    if (!mediaUrl)
        return false;
    const fileName = (0, media_url_utils_1.resolveFileNameFromMediaUrl)(mediaUrl);
    if (!fileName)
        return false;
    return isImageFileName(fileName);
}
/**
 * Fetch an image from a URL (or an allowed local path) and upload it to
 * Feishu IM storage, returning the assigned `image_key`.
 *
 * Wraps the internal {@link fetchMediaBuffer} + {@link uploadImageLark} pair
 * so the multi-image post path can collect image_keys for every URL before
 * issuing a single combined message. Any fetch/upload failure propagates to
 * the caller, which then falls back to the legacy per-media send path.
 */
async function uploadImageFromUrlLark(params) {
    const { cfg, mediaUrl, mediaLocalRoots, accountId } = params;
    const maxBytes = resolveOutboundMediaMaxBytes(cfg, accountId);
    const buffer = await fetchMediaBuffer(mediaUrl, mediaLocalRoots, maxBytes);
    log.debug(`uploadImageFromUrlLark: fetched "${mediaUrl}", ${buffer.length} bytes`);
    return uploadImageLark({ cfg, image: buffer, imageType: 'message', accountId });
}
// ---------------------------------------------------------------------------
// uploadFileLark
// ---------------------------------------------------------------------------
/**
 * Upload a file to Feishu IM storage.
 *
 * @param params.cfg       - Plugin configuration.
 * @param params.file      - A Buffer or local file path.
 * @param params.fileName  - The display name of the file.
 * @param params.fileType  - Feishu file type: "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream".
 * @param params.duration  - Duration in milliseconds (for audio/video files).
 * @param params.accountId - Optional account identifier.
 * @returns The assigned file_key.
 */
async function uploadFileLark(params) {
    const { cfg, file, fileName, fileType, duration, accountId } = params;
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const fileStream = Buffer.isBuffer(file) ? node_stream_1.Readable.from(file) : fs.createReadStream(file);
    const response = await client.im.file.create({
        data: {
            file_type: fileType,
            file_name: fileName,
            file: fileStream,
            ...(duration !== undefined ? { duration: String(duration) } : {}),
        },
    });
    const fileKey = response?.data?.file_key ?? response?.file_key;
    if (!fileKey) {
        throw new Error(`[feishu-media] File upload failed: no file_key in response for "${fileName}" (type=${fileType}). ` +
            `Response: ${JSON.stringify(response).slice(0, 200)}`);
    }
    return { fileKey };
}
// ---------------------------------------------------------------------------
// Shared media message sender
// ---------------------------------------------------------------------------
/**
 * Unified media message sender — handles both reply and create paths for
 * image / file / audio `msg_type` values.
 *
 * Mirrors {@link sendImMessage} in `deliver.ts` (which covers "post" and
 * "interactive"), extracted here to avoid a cross-module dependency.
 */
async function sendMediaMessage(params) {
    const { client, to, content, msgType, replyToMessageId, replyInThread } = params;
    if (replyToMessageId) {
        const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.reply({
            path: { message_id: replyToMessageId },
            data: { content, msg_type: msgType, reply_in_thread: replyInThread },
        }), 'im.message.reply(media)');
        return {
            messageId: response?.data?.message_id ?? '',
            chatId: response?.data?.chat_id ?? '',
        };
    }
    const target = (0, targets_1.normalizeFeishuTarget)(to);
    if (!target) {
        throw new Error(`[feishu-media] Cannot send ${msgType} message: "${to}" is not a valid target. ` +
            `Expected a chat_id (oc_*), open_id (ou_*), or user_id.`);
    }
    const receiveIdType = (0, targets_1.resolveReceiveIdType)(target);
    const response = await (0, send_rate_limit_1.feishuSendRequest)(() => client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: { receive_id: target, msg_type: msgType, content },
    }), 'im.message.create(media)');
    return {
        messageId: response?.data?.message_id ?? '',
        chatId: response?.data?.chat_id ?? '',
    };
}
// ---------------------------------------------------------------------------
// sendImageLark
// ---------------------------------------------------------------------------
/**
 * Send an image message to a chat or user.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.imageKey         - The image_key from a previous upload.
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.replyInThread    - When true, reply appears in thread.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result.
 */
async function sendImageLark(params) {
    const { cfg, to, imageKey, replyToMessageId, replyInThread, accountId } = params;
    log.info(`sendImageLark: target=${to}, imageKey=${imageKey}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify({ image_key: imageKey });
    return sendMediaMessage({ client, to, content, msgType: 'image', replyToMessageId, replyInThread });
}
// ---------------------------------------------------------------------------
// sendFileLark
// ---------------------------------------------------------------------------
/**
 * Send a file message to a chat or user.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.fileKey          - The file_key from a previous upload.
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.replyInThread    - When true, reply appears in thread.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result.
 */
async function sendFileLark(params) {
    const { cfg, to, fileKey, replyToMessageId, replyInThread, accountId } = params;
    log.info(`sendFileLark: target=${to}, fileKey=${fileKey}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify({ file_key: fileKey });
    return sendMediaMessage({ client, to, content, msgType: 'file', replyToMessageId, replyInThread });
}
// ---------------------------------------------------------------------------
// sendVideoLark
// ---------------------------------------------------------------------------
/**
 * Send a video message to a chat or user.
 *
 * Uses `msg_type: "media"` so Feishu renders the message as a playable
 * video instead of a file attachment.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.fileKey          - The file_key from a previous upload.
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.replyInThread    - When true, reply appears in thread.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result.
 */
async function sendVideoLark(params) {
    const { cfg, to, fileKey, replyToMessageId, replyInThread, accountId } = params;
    log.info(`sendVideoLark: target=${to}, fileKey=${fileKey}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify({ file_key: fileKey });
    return sendMediaMessage({ client, to, content, msgType: 'media', replyToMessageId, replyInThread });
}
// ---------------------------------------------------------------------------
// sendAudioLark
// ---------------------------------------------------------------------------
/**
 * Send an audio message to a chat or user.
 *
 * Uses `msg_type: "audio"` so Feishu renders the message as a playable
 * voice bubble instead of a file attachment.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.fileKey          - The file_key from a previous upload.
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.replyInThread    - When true, reply appears in thread.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result.
 */
async function sendAudioLark(params) {
    const { cfg, to, fileKey, replyToMessageId, replyInThread, accountId } = params;
    log.info(`sendAudioLark: target=${to}, fileKey=${fileKey}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const content = JSON.stringify({ file_key: fileKey });
    return sendMediaMessage({ client, to, content, msgType: 'audio', replyToMessageId, replyInThread });
}
// ---------------------------------------------------------------------------
// detectFileType
// ---------------------------------------------------------------------------
/** Known image extensions. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.ico', '.tiff', '.tif', '.heic']);
/** Extension-to-Feishu-file-type mapping. */
const EXTENSION_TYPE_MAP = {
    '.opus': 'opus',
    '.ogg': 'opus',
    '.mp4': 'mp4',
    '.mov': 'mp4',
    '.avi': 'mp4',
    '.mkv': 'mp4',
    '.webm': 'mp4',
    '.pdf': 'pdf',
    '.doc': 'doc',
    '.docx': 'doc',
    '.xls': 'xls',
    '.xlsx': 'xls',
    '.csv': 'xls',
    '.ppt': 'ppt',
    '.pptx': 'ppt',
};
/**
 * Detect the Feishu file type from a file name extension.
 *
 * Returns one of the Feishu-supported file type strings, or "stream"
 * as a catch-all for unrecognised extensions.
 *
 * @param fileName - The file name (with extension).
 * @returns The detected file type.
 */
function detectFileType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return EXTENSION_TYPE_MAP[ext] ?? 'stream';
}
/**
 * Parse the duration (in milliseconds) from an OGG/Opus audio buffer.
 *
 * Scans backward from the end of the buffer to find the last OggS page
 * header, reads the granule position (absolute sample count), and divides
 * by 48 000 (the Opus standard sample rate) then converts to milliseconds.
 *
 * Returns `undefined` when the buffer cannot be parsed (e.g. truncated or
 * not actually OGG).  This is intentionally lenient so callers can fall
 * back gracefully.
 */
function parseOggOpusDuration(buffer) {
    // OggS magic bytes: 0x4f 0x67 0x67 0x53
    const OGGS = Buffer.from('OggS');
    // Scan backwards for the last OggS sync word.
    let offset = -1;
    for (let i = buffer.length - OGGS.length; i >= 0; i--) {
        if (buffer[i] === 0x4f && buffer.compare(OGGS, 0, 4, i, i + 4) === 0) {
            offset = i;
            break;
        }
    }
    if (offset < 0)
        return undefined;
    // Granule position is at bytes 6..13 of the page header (8 bytes, little-endian).
    const granuleOffset = offset + 6;
    if (granuleOffset + 8 > buffer.length)
        return undefined;
    // Read as two 32-bit LE values and combine (avoids BigInt for portability).
    const lo = buffer.readUInt32LE(granuleOffset);
    const hi = buffer.readUInt32LE(granuleOffset + 4);
    const granule = hi * 0x1_0000_0000 + lo;
    if (granule <= 0)
        return undefined;
    return Math.ceil(granule / 48_000) * 1000;
}
/**
 * Parse the duration (in milliseconds) from an MP4 video buffer.
 *
 * Scans top-level boxes to locate the `moov` container, then finds the
 * `mvhd` (Movie Header) box inside it.  The `mvhd` box stores:
 *   - **timescale**: number of time-units per second
 *   - **duration**: total duration in those time-units
 *
 * Supports both version-0 (32-bit fields) and version-1 (64-bit fields)
 * of the `mvhd` box.
 *
 * Returns `undefined` when the buffer cannot be parsed (e.g. truncated,
 * `moov` at end of a huge file not fully buffered, or not actually MP4).
 */
function parseMp4Duration(buffer) {
    // Locate `moov` among top-level boxes.
    const moovData = findBox(buffer, 0, buffer.length, 'moov');
    if (!moovData)
        return undefined;
    // Locate `mvhd` inside `moov`.
    const mvhdData = findBox(buffer, moovData.dataStart, moovData.dataEnd, 'mvhd');
    if (!mvhdData)
        return undefined;
    const off = mvhdData.dataStart;
    if (off + 1 > buffer.length)
        return undefined;
    const version = buffer.readUInt8(off);
    let timescale;
    let duration;
    if (version === 0) {
        // version(1) + flags(3) + creation(4) + modification(4) + timescale(4) + duration(4) = 20 bytes
        if (off + 20 > buffer.length)
            return undefined;
        timescale = buffer.readUInt32BE(off + 12);
        duration = buffer.readUInt32BE(off + 16);
    }
    else {
        // version(1) + flags(3) + creation(8) + modification(8) + timescale(4) + duration(8) = 32 bytes
        if (off + 32 > buffer.length)
            return undefined;
        timescale = buffer.readUInt32BE(off + 20);
        // Read 64-bit duration as two 32-bit halves (avoids BigInt).
        const hi = buffer.readUInt32BE(off + 24);
        const lo = buffer.readUInt32BE(off + 28);
        duration = hi * 0x1_0000_0000 + lo;
    }
    if (timescale <= 0 || duration <= 0)
        return undefined;
    return Math.round((duration / timescale) * 1000);
}
/**
 * Find a box (atom) by its 4-character type within a range of the buffer.
 * Returns the data start/end offsets (after the 8-byte box header), or
 * `undefined` if not found.
 */
function findBox(buffer, start, end, type) {
    let offset = start;
    while (offset + 8 <= end) {
        const size = buffer.readUInt32BE(offset);
        const boxType = buffer.toString('ascii', offset + 4, offset + 8);
        // size == 0 means box extends to the end; size == 1 means 64-bit extended size.
        let boxEnd;
        let dataStart;
        if (size === 0) {
            boxEnd = end;
            dataStart = offset + 8;
        }
        else if (size === 1) {
            if (offset + 16 > end)
                break;
            const hi = buffer.readUInt32BE(offset + 8);
            const lo = buffer.readUInt32BE(offset + 12);
            boxEnd = offset + hi * 0x1_0000_0000 + lo;
            dataStart = offset + 16;
        }
        else {
            if (size < 8)
                break; // invalid
            boxEnd = offset + size;
            dataStart = offset + 8;
        }
        if (boxType === type) {
            return { dataStart, dataEnd: Math.min(boxEnd, end) };
        }
        offset = boxEnd;
    }
    return undefined;
}
/**
 * Check whether a file name has an image extension.
 */
function isImageFileName(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}
// ---------------------------------------------------------------------------
// uploadAndSendMediaLark
// ---------------------------------------------------------------------------
/**
 * Upload and send a media file (image or general file) in one step.
 *
 * Accepts either a URL (remote or local `file://`) or a raw Buffer.
 * The function determines whether the media is an image (by extension)
 * and uses the appropriate upload/send path.
 *
 * @param params.cfg              - Plugin configuration.
 * @param params.to               - Target identifier.
 * @param params.mediaUrl         - URL of the media (http/https or local path).
 * @param params.mediaBuffer      - Raw bytes of the media (alternative to URL).
 * @param params.fileName         - File name (used for type detection and display).
 * @param params.replyToMessageId - Optional message ID for threaded reply.
 * @param params.accountId        - Optional account identifier.
 * @returns The send result.
 */
async function uploadAndSendMediaLark(params) {
    const { cfg, to, mediaUrl, mediaBuffer, fileName, replyToMessageId, replyInThread, accountId, mediaLocalRoots } = params;
    log.info(`uploadAndSendMediaLark: target=${to}, ` +
        `source=${mediaBuffer ? 'buffer' : (mediaUrl ?? '(none)')}, fileName=${fileName ?? '(auto)'}`);
    // Resolve the media to a Buffer.
    let buffer;
    let resolvedFileName = fileName ?? 'file';
    const maxBytes = resolveOutboundMediaMaxBytes(cfg, accountId);
    if (mediaBuffer) {
        buffer = mediaBuffer;
        log.debug(`using provided buffer: ${buffer.length} bytes`);
    }
    else if (mediaUrl) {
        buffer = await fetchMediaBuffer(mediaUrl, mediaLocalRoots, maxBytes);
        log.debug(`fetched media: ${buffer.length} bytes from "${mediaUrl}"`);
        // Derive a file name from the URL if none was provided.
        if (!fileName) {
            const derivedFileName = (0, media_url_utils_1.resolveFileNameFromMediaUrl)(mediaUrl);
            if (derivedFileName) {
                resolvedFileName = derivedFileName;
            }
        }
    }
    else {
        throw new Error('[feishu-media] uploadAndSendMediaLark requires either mediaUrl or mediaBuffer. ' +
            'Provide a URL (http/https/file://) or a raw Buffer to send media.');
    }
    // Defense-in-depth: enforce the cap on the resolved buffer too, so a
    // directly-provided `mediaBuffer` cannot bypass the limit.
    if (buffer.length > maxBytes) {
        throw new Error(`[feishu-media] Media is ${formatBytes(buffer.length)}, ` +
            `over the ${formatBytes(maxBytes)} upload limit. ` +
            `Increase channels.feishu.mediaMaxMb (max ${formatBytes(FEISHU_MAX_FILE_UPLOAD_BYTES)}) or send a smaller file.`);
    }
    // Decide whether to send as image or file based on the extension.
    const isImage = isImageFileName(resolvedFileName);
    log.info(`resolved: fileName="${resolvedFileName}", ` + `type=${isImage ? 'image' : 'file'}, size=${buffer.length}`);
    if (isImage) {
        // Upload as image, then send image message.
        const { imageKey } = await uploadImageLark({
            cfg,
            image: buffer,
            imageType: 'message',
            accountId,
        });
        log.debug(`image uploaded: imageKey=${imageKey}`);
        return sendImageLark({
            cfg,
            to,
            imageKey,
            replyToMessageId,
            replyInThread,
            accountId,
        });
    }
    // Upload as file, then send as file or audio message.
    const fileType = detectFileType(resolvedFileName);
    const isAudio = fileType === 'opus';
    const isVideo = fileType === 'mp4';
    const duration = isAudio ? parseOggOpusDuration(buffer) : isVideo ? parseMp4Duration(buffer) : undefined;
    const { fileKey } = await uploadFileLark({
        cfg,
        file: buffer,
        fileName: resolvedFileName,
        fileType,
        duration,
        accountId,
    });
    log.debug(`file uploaded: fileKey=${fileKey}, ` +
        `fileType=${fileType}${isAudio || isVideo ? `, duration=${duration ?? 'unknown'}ms` : ''}`);
    if (isAudio) {
        return sendAudioLark({ cfg, to, fileKey, replyToMessageId, replyInThread, accountId });
    }
    if (isVideo) {
        return sendVideoLark({ cfg, to, fileKey, replyToMessageId, replyInThread, accountId });
    }
    return sendFileLark({
        cfg,
        to,
        fileKey,
        replyToMessageId,
        replyInThread,
        accountId,
    });
}
// ---------------------------------------------------------------------------
// fetchRemoteImageBuffer — public wrapper for remote-only image downloads
// ---------------------------------------------------------------------------
/**
 * Fetch remote image bytes by URL (http/https only).
 * Local file access is denied. Includes SSRF protection.
 */
async function fetchRemoteImageBuffer(url) {
    return fetchMediaBuffer(url, undefined, FEISHU_MAX_FILE_UPLOAD_BYTES);
}
// ---------------------------------------------------------------------------
// SSRF protection — SDK fetch guard (DNS pinning + private-IP blocking)
// ---------------------------------------------------------------------------
/**
 * Validate that a remote URL does not target private/reserved IP addresses.
 *
 * Delegates to the OpenClaw SDK `fetchWithSsrFGuard` (same implementation the
 * official @openclaw/feishu plugin uses for its outbound fetches):
 * - DNS-pinned lookup prevents DNS-rebinding attacks (resolve once, reuse)
 * - Blocks IPv4 + IPv6 private/reserved ranges (loopback, link-local, ULA,
 *   cloud-metadata 169.254.x.x, etc.)
 * - Re-validates every redirect hop against the same policy
 *
 * @param {string} raw remote http(s) URL
 * @returns {Promise<void>} resolves when the URL is safe to fetch
 */
async function validateRemoteUrl(raw) {
    // guardedRemoteFetch performs the SSRF check before connecting; a blocked
    // target rejects with SsrFBlockedError before any bytes are exchanged.
    // We only need a protocol sanity check here to fail fast with a clear error.
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`[feishu-media] Unsupported protocol "${parsed.protocol}" in URL "${raw}". ` +
            `Only http:// and https:// are allowed for remote media.`);
    }
}
// ---------------------------------------------------------------------------
// fetchMediaBuffer
// ---------------------------------------------------------------------------
/**
 * Fetch media bytes from a URL or local file path.
 *
 * Supports:
 * - `http://` and `https://` URLs (fetched via the global `fetch` API)
 * - `file://` URLs and bare file system paths (read from disk, gated
 *   by `localRoots` for path-traversal prevention)
 */
async function fetchMediaBuffer(urlOrPath, localRoots, maxBytes = FEISHU_MAX_FILE_UPLOAD_BYTES) {
    const raw = (0, media_url_utils_1.normalizeMediaUrlInput)(urlOrPath);
    // Local file path (absolute or relative, or file:// URL).
    if ((0, media_url_utils_1.isLocalMediaPath)(raw)) {
        const filePath = raw.startsWith('file://') ? (0, media_url_utils_1.safeFileUrlToPath)(raw) : raw;
        if (localRoots !== undefined) {
            // Explicit allowlist configured — enforce path restriction.
            (0, media_url_utils_1.validateLocalMediaRoots)(filePath, localRoots);
        }
        else {
            // Deny by default: unconfigured mediaLocalRoots must not allow
            // arbitrary local file reads.
            throw new Error(`[feishu-media] Local file access denied for "${filePath}": ` +
                `mediaLocalRoots is not configured. ` +
                `Configure mediaLocalRoots to explicitly allow local file access.`);
        }
        // Enforce the size cap before reading the whole file into memory.
        const stat = fs.statSync(filePath);
        if (stat.size > maxBytes) {
            throw new Error(`[feishu-media] Local media "${filePath}" is ${formatBytes(stat.size)}, ` +
                `over the ${formatBytes(maxBytes)} upload limit. ` +
                `Increase channels.feishu.mediaMaxMb (max ${formatBytes(FEISHU_MAX_FILE_UPLOAD_BYTES)}) or send a smaller file.`);
        }
        const buf = fs.readFileSync(filePath);
        log.debug(`local file read: "${filePath}", ${buf.length} bytes`);
        return buf;
    }
    // Remote URL — validate against SSRF before fetching.
    await validateRemoteUrl(raw);
    const FETCH_TIMEOUT_MS = 30_000;
    log.info(`fetching remote media: ${raw}`);
    // Retry transient server errors (502/503/504) with bounded backoff.
    const buffer = await withRetry(async () => {
        const { response, release } = await (0, ssrf_1.guardedRemoteFetch)(raw, undefined, {
            timeoutMs: FETCH_TIMEOUT_MS,
            auditContext: 'feishu-media-fetch',
        });
        try {
            if (!response.ok) {
                // Attach status so withRetry can inspect it.
                const err = new Error(`[feishu-media] Failed to fetch media from "${raw}": ` +
                    `HTTP ${response.status} ${response.statusText}. ` +
                    `Verify the URL is accessible and returns a valid media resource.`);
                err.status = response.status;
                throw err;
            }
            return await readResponseBodyWithCap(response, maxBytes, raw);
        }
        finally {
            await release();
        }
    }, `fetchMedia(${raw})`);
    log.debug(`remote media fetched: ${raw}, ${buffer.length} bytes`);
    return buffer;
}
