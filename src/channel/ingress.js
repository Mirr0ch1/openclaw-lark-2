"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Durable inbound admission for Feishu.
 *
 * Ported in spirit from @openclaw/feishu `src/feishu-ingress.ts`.
 *
 * Recognised durable event types are persisted to the host-provided ingress
 * queue (`runtime.state.openChannelIngressQueue`) keyed by Feishu `event_id`
 * and ordered per lane (chat / document). Everything else — including card
 * actions — is *not* inspected as durable and is dispatched directly, so the
 * interactive paths are unaffected.
 *
 * The host owns queue persistence, claims and retention; this module owns
 * transport inspection, payload shape and delivery policy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEISHU_INGRESS_PAYLOAD_VERSION = void 0;
exports.inspectFeishuIngressEnvelope = inspectFeishuIngressEnvelope;
exports.createFeishuDurableIngress = createFeishuDurableIngress;
const Lark = require("@larksuiteoapi/node-sdk");
const channel_outbound_1 = require("openclaw/plugin-sdk/channel-outbound");
const lark_logger_1 = require("../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('channel/ingress');
/** Malformed/undecryptable envelopes are terminal, not retryable. */
const FeishuIngressPermanentError = (0, channel_outbound_1.createChannelIngressError)('FeishuIngressPermanentError', { withReason: true });
const FEISHU_INGRESS_PAYLOAD_VERSION = 1;
exports.FEISHU_INGRESS_PAYLOAD_VERSION = FEISHU_INGRESS_PAYLOAD_VERSION;
/** Event types admitted to the durable queue. Everything else dispatches directly. */
const FEISHU_DURABLE_EVENT_TYPES = new Set([
    'im.message.receive_v1',
    'drive.notice.comment_add_v1',
]);
const FEISHU_INGRESS_POLL_INTERVAL_MS = 500;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/**
 * Extract durable identity + ordering lane from a raw Feishu envelope.
 *
 * Returns `null` for envelopes we do not admit durably (non-durable event
 * types, unparseable JSON, or a missing `event_id`), which callers dispatch
 * directly. With `allowInvalidLane`, a recognised event that lacks its lane
 * identity is still admitted under an `invalid:` lane so the drain can
 * dead-letter it without blocking the chat lane.
 */
function parseIngressEnvelope(rawEnvelope, encryptKey) {
    let parsed;
    try {
        parsed = JSON.parse(rawEnvelope);
    }
    catch {
        return null;
    }
    if (!isRecord(parsed))
        return null;
    // Encrypted deliveries are classified on their decrypted body. The stored
    // raw envelope stays encrypted; the dispatcher decrypts it at delivery.
    const encrypted = readString(parsed.encrypt);
    if (!encrypted)
        return parsed;
    if (!encryptKey)
        return null;
    try {
        const decrypted = new Lark.AESCipher(encryptKey).decrypt(encrypted);
        const body = JSON.parse(decrypted);
        return isRecord(body) ? body : null;
    }
    catch {
        return null;
    }
}
function inspectFeishuIngressEnvelope(rawEnvelope, options = {}) {
    const parsed = parseIngressEnvelope(rawEnvelope, options.encryptKey);
    if (!parsed)
        return null;
    const header = isRecord(parsed.header) ? parsed.header : undefined;
    const event = isRecord(parsed.event) ? parsed.event : undefined;
    const eventType = readString(header?.event_type) ?? readString(parsed.event_type);
    if (!eventType || !FEISHU_DURABLE_EVENT_TYPES.has(eventType))
        return null;
    const eventId = readString(header?.event_id) ?? readString(parsed.event_id);
    if (!eventId)
        return null;
    const eventBody = event ?? parsed;
    const invalid = () => (options.allowInvalidLane ? { eventId, laneKey: `invalid:${eventType}:${eventId}` } : null);
    if (eventType === 'im.message.receive_v1') {
        const message = isRecord(eventBody.message) ? eventBody.message : undefined;
        const chatId = readString(message?.chat_id);
        return chatId ? { eventId, laneKey: `chat:${chatId}` } : invalid();
    }
    const noticeMeta = isRecord(eventBody.notice_meta) ? eventBody.notice_meta : undefined;
    const fileType = readString(noticeMeta?.file_type);
    const documentId = readString(noticeMeta?.file_token);
    if (!fileType || !documentId)
        return invalid();
    return { eventId, laneKey: `comment-doc:${fileType}:${documentId}` };
}
/**
 * Create the durable ingress, or `null` when the host does not expose an
 * ingress queue (older runtimes) — callers then dispatch directly.
 */
function createFeishuDurableIngress(params) {
    const state = params.runtime?.state;
    const openQueue = state?.openChannelIngressQueue;
    if (typeof openQueue !== 'function') {
        return null;
    }
    const { accountId, dispatcher, log: paramLog } = params;
    const emitWarn = paramLog ?? ((message) => log.warn(message));
    // Lifecycles for in-flight deliveries, keyed by Feishu `event_id`. The
    // receive handler resolves its turn lifecycle from here (the SDK merges the
    // envelope `header` — incl. `event_id` — into the parsed event `data`), so a
    // deferred (debounced) delivery can adopt/abandon its durable row later.
    const activeLifecycles = new Map();
    const monitor = (0, channel_outbound_1.createChannelIngressMonitor)({
        queue: () => openQueue.call(state, { accountId }),
        inspect: (rawEnvelope, context) => inspectFeishuIngressEnvelope(rawEnvelope, {
            // Admit lane-less recognised events under an invalid lane so they
            // can be dead-lettered; at claim time a missing lane is terminal.
            allowInvalidLane: context?.phase === 'admission',
            encryptKey: params.encryptKey,
        }),
        payload: {
            version: FEISHU_INGRESS_PAYLOAD_VERSION,
            serialize: (rawEnvelope, { receivedAt }) => ({ receivedAt, rawEnvelope }),
            deserialize: (body) => body.rawEnvelope,
            encode: ({ body }) => ({ version: FEISHU_INGRESS_PAYLOAD_VERSION, ...body }),
            decode: (payload) => ({
                version: payload.version,
                body: { receivedAt: payload.receivedAt, rawEnvelope: payload.rawEnvelope },
            }),
            createClaimError: (kind, claim) => new FeishuIngressPermanentError('invalid-event', `Feishu ingress row ${claim.id} has invalid delivery identity (${kind}).`),
        },
        deliver: async (rawEnvelope, lifecycle, claim) => {
            // Per-delivery abandon-handler registry. Handlers can defer transport
            // settlement (e.g. debounce) and register a cleanup that must run if
            // the delivery is abandoned. Kept local; the monitor owns the claim.
            const abandonHandlers = new Set();
            const wrappedLifecycle = {
                ...lifecycle,
                onAdopted: lifecycle.onAdopted,
                onAbandoned: async () => {
                    await Promise.allSettled([...abandonHandlers].map(async (handler) => await handler()));
                    await lifecycle.onAbandoned();
                },
                registerAbandonHandler: (handler) => {
                    abandonHandlers.add(handler);
                    return () => abandonHandlers.delete(handler);
                },
            };
            const eventId = inspectFeishuIngressEnvelope(rawEnvelope, { encryptKey: params.encryptKey })?.eventId;
            if (eventId)
                activeLifecycles.set(eventId, wrappedLifecycle);
            try {
                const result = await dispatcher.invoke(JSON.parse(rawEnvelope), { needCheck: false });
                // This plugin's handlers enqueue to the per-chat queue and return
                // `undefined`, so the durable row is complete once admission +
                // enqueue succeeded. Honour explicit `deferred` / `completed` /
                // `failed-retryable` results rather than marking a deferred turn
                // complete.
                if (isRecord(result)) {
                    if (result.kind === 'deferred')
                        return { kind: 'deferred' };
                    if (result.kind === 'failed-retryable') {
                        return { kind: 'failed-retryable', error: result.error };
                    }
                    if (result.kind === 'completed')
                        return { kind: 'completed' };
                }
                return { kind: 'completed' };
            }
            finally {
                if (eventId && activeLifecycles.get(eventId) === wrappedLifecycle) {
                    activeLifecycles.delete(eventId);
                }
            }
        },
        // Deferred (debounced) deliveries must settle before the monitor stops.
        deferredClaims: 'wait-on-stop',
        pollIntervalMs: FEISHU_INGRESS_POLL_INTERVAL_MS,
        retention: 'standard',
        drain: {
            // Without this the drain treats malformed/undecryptable rows as
            // retryable and re-pumps them for ~24h instead of dead-lettering.
            resolveNonRetryableFailure: (error) => error instanceof FeishuIngressPermanentError
                ? { reason: error.reason ?? 'invalid-event', message: error.message }
                : null,
        },
        onError: (error) => {
            emitWarn(`feishu[${accountId}]: durable ingress error: ${error instanceof Error ? error.message : String(error)}`);
        },
    });
    const invokeWebhook = async (data, invokeParams) => {
        let rawEnvelope;
        try {
            rawEnvelope = typeof data === 'string' ? data : JSON.stringify(data);
        }
        catch {
            return { kind: 'non-durable', value: await dispatcher.invoke(data, invokeParams) };
        }
        const facts = inspectFeishuIngressEnvelope(rawEnvelope, {
            allowInvalidLane: true,
            encryptKey: params.encryptKey,
        });
        if (!facts) {
            return { kind: 'non-durable', value: await dispatcher.invoke(data, invokeParams) };
        }
        await monitor.admit(rawEnvelope, {
            facts: { eventId: facts.eventId, laneKey: facts.laneKey },
        });
        return { kind: 'durable', value: undefined };
    };
    return {
        invoke: async (data, invokeParams) => (await invokeWebhook(data, invokeParams)).value,
        invokeWebhook,
        resolveLifecycle: (data) => {
            const eventId = isRecord(data) ? readString(data.event_id) : undefined;
            return eventId ? activeLifecycles.get(eventId) : undefined;
        },
        start: () => monitor.start(),
        stop: async () => {
            await monitor.stop();
            activeLifecycles.clear();
        },
    };
}
