"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu webhook transport.
 *
 * Ported in spirit from @openclaw/feishu `src/monitor.transport.ts`
 * (`monitorWebhook` + `handleFeishuWebhook`).
 *
 * Feishu can deliver events either over a long-lived WebSocket or by POSTing
 * to a callback URL. This module implements the callback path: a plugin-owned
 * Gateway HTTP route that verifies the delivery signature, answers the
 * `url_verification` challenge, and hands the envelope to the same
 * EventDispatcher the WebSocket path uses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FEISHU_WEBHOOK_PATH = void 0;
exports.normalizeFeishuWebhookPath = normalizeFeishuWebhookPath;
exports.isFeishuWebhookTimestampFresh = isFeishuWebhookTimestampFresh;
exports.computeFeishuWebhookSignature = computeFeishuWebhookSignature;
exports.isFeishuWebhookSignatureValid = isFeishuWebhookSignatureValid;
exports.buildFeishuWebhookEnvelope = buildFeishuWebhookEnvelope;
exports.createFeishuWebhookHandler = createFeishuWebhookHandler;
exports.monitorFeishuWebhook = monitorFeishuWebhook;
const crypto = require("node:crypto");
const Lark = require("@larksuiteoapi/node-sdk");
const webhook_ingress_1 = require("openclaw/plugin-sdk/webhook-ingress");
const channel_outbound_1 = require("openclaw/plugin-sdk/channel-outbound");
const account_id_1 = require("openclaw/plugin-sdk/account-id");
const ingress_1 = require("./ingress.js");
const lark_logger_1 = require("../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('channel/webhook');
const DEFAULT_FEISHU_WEBHOOK_PATH = '/feishu/webhook';
exports.DEFAULT_FEISHU_WEBHOOK_PATH = DEFAULT_FEISHU_WEBHOOK_PATH;
/**
 * Feishu signs each delivery at send time, so a captured signed callback stays
 * validly signed forever. Reject deliveries whose signed timestamp is too far
 * from the local clock (generous for provider retries and host clock skew).
 */
const FEISHU_WEBHOOK_TIMESTAMP_MAX_SKEW_MS = 60 * 60 * 1000;
/** Max concurrent webhook handlers per account before requests are rejected. */
const FEISHU_PRE_AUTH_MAX_IN_FLIGHT = 64;
/** Plugin id used for route ownership (must match this plugin's id). */
const FEISHU_PLUGIN_ID = 'openclaw-lark-2';
/** Payload keys that must not shadow the trusted SDK envelope prototype. */
const BLOCKED_WEBHOOK_PAYLOAD_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'headers']);
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/**
 * Canonicalise a configured webhook path (leading slash, no duplicate/trailing slash).
 *
 * The host keys Gateway route ownership on auth+pluginId+source and ignores
 * `accountId`, so the default path is account-scoped: named accounts get
 * `<base>/<accountId>`. Two webhook accounts left on the same path would
 * otherwise silently share one handler.
 */
function normalizeFeishuWebhookPath(raw, accountId) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const fallback = accountId && accountId !== account_id_1.DEFAULT_ACCOUNT_ID
        ? `${DEFAULT_FEISHU_WEBHOOK_PATH}/${accountId}`
        : DEFAULT_FEISHU_WEBHOOK_PATH;
    const candidate = trimmed || fallback;
    const withLeading = candidate.startsWith('/') ? candidate : `/${candidate}`;
    const collapsed = withLeading.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}
function isFeishuWebhookTimestampFresh(timestamp, nowMs = Date.now(), maxSkewMs = FEISHU_WEBHOOK_TIMESTAMP_MAX_SKEW_MS) {
    const parsed = Number.parseInt(String(timestamp ?? ''), 10);
    if (!Number.isFinite(parsed))
        return false;
    // Feishu signs with second-level timestamps; tolerate millisecond values too.
    const timestampMs = parsed < 1e12 ? parsed * 1000 : parsed;
    return Math.abs(nowMs - timestampMs) <= maxSkewMs;
}
function computeFeishuWebhookSignature(params) {
    return crypto
        .createHash('sha256')
        .update(String(params.timestamp) + String(params.nonce) + String(params.encryptKey) + String(params.rawBody))
        .digest('hex');
}
function firstHeader(value) {
    return Array.isArray(value) ? value[0] : value;
}
function safeEqual(a, b) {
    const left = Buffer.from(String(a), 'utf8');
    const right = Buffer.from(String(b), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
/** Verify the `x-lark-*` delivery signature against the raw request body. */
function isFeishuWebhookSignatureValid(params) {
    const timestamp = firstHeader(params.headers?.['x-lark-request-timestamp']);
    const nonce = firstHeader(params.headers?.['x-lark-request-nonce']);
    const signature = firstHeader(params.headers?.['x-lark-signature']);
    if (!timestamp || !nonce || !signature || !params.encryptKey)
        return false;
    if (!isFeishuWebhookTimestampFresh(timestamp, params.nowMs))
        return false;
    const computed = computeFeishuWebhookSignature({
        timestamp,
        nonce,
        encryptKey: params.encryptKey,
        rawBody: params.rawBody,
    });
    return safeEqual(computed, signature);
}
/**
 * Build the envelope handed to the EventDispatcher: payload keys plus a
 * `headers` prototype, so a hostile payload cannot shadow the trusted
 * request headers the SDK reads.
 */
function buildFeishuWebhookEnvelope(req, payload) {
    const envelope = Object.create({ headers: req.headers });
    for (const [key, value] of Object.entries(payload)) {
        if (!BLOCKED_WEBHOOK_PAYLOAD_KEYS.has(key)) {
            envelope[key] = value;
        }
    }
    return envelope;
}
function respondJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function respondText(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(body);
}
/** Create the Gateway HTTP route handler for one account. */
function createFeishuWebhookHandler(params) {
    return async (req, res) => {
        // Method / content-type / per-key concurrency guards run *before* the
        // body is read, so an unauthenticated caller cannot make us buffer.
        const admission = (0, webhook_ingress_1.beginWebhookRequestPipelineOrReject)({
            req,
            res,
            allowMethods: ['POST'],
            requireJsonContentType: true,
            ...(params.inFlightLimiter
                ? {
                    inFlightLimiter: params.inFlightLimiter,
                    inFlightKey: params.inFlightKey ?? FEISHU_PLUGIN_ID,
                }
                : {}),
        });
        if (!admission.ok) {
            return;
        }
        let released = false;
        const release = () => {
            if (!released) {
                released = true;
                admission.release();
            }
        };
        try {
            // Bounded read; size/timeout failures are answered (413/408) here.
            const body = await (0, webhook_ingress_1.readWebhookBodyOrReject)({
                req,
                res,
                // Signature can only be checked after the body is read, so this
                // is structurally a pre-auth read and must use the tight profile.
                profile: 'pre-auth',
            });
            if (!body.ok) {
                return;
            }
            const rawBody = body.value;
            if (!isFeishuWebhookSignatureValid({
                headers: req.headers,
                rawBody,
                encryptKey: params.encryptKey,
                nowMs: params.now?.(),
            })) {
                respondText(res, 401, 'Invalid signature');
                return;
            }
            // Authenticated: free the pre-auth slot before dispatch so a slow
            // agent turn cannot make the route reject new deliveries.
            release();
            let payload;
            try {
                payload = JSON.parse(rawBody);
            }
            catch {
                respondText(res, 400, 'Invalid JSON');
                return;
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                respondText(res, 400, 'Invalid JSON');
                return;
            }
            // Feishu URL verification (plain or encrypted) must echo the challenge.
            const { isChallenge, challenge } = Lark.generateChallenge(payload, {
                encryptKey: params.encryptKey,
            });
            if (isChallenge) {
                respondJson(res, 200, challenge);
                return;
            }
            const envelope = buildFeishuWebhookEnvelope(req, payload);
            const invoke = params.invokeEnvelope ??
                ((target) => params.dispatcher.invoke(target, { needCheck: false }));
            await invoke(envelope);
            if (!res.headersSent) {
                respondJson(res, 200, {});
            }
        }
        catch (err) {
            log.error(`feishu webhook handler failed: ${err instanceof Error ? err.message : String(err)}`);
            if (!res.headersSent) {
                respondText(res, 500, 'Internal Server Error');
            }
        }
        finally {
            release();
        }
    };
}
/**
 * Register the webhook route and keep the account alive until aborted.
 *
 * Requires `encryptKey`: signature verification is the only authentication
 * on this route, so an account without one is rejected rather than exposed.
 */
async function monitorFeishuWebhook(params) {
    const { account, accountId, abortSignal, handlers, log: paramLog } = params;
    const emit = paramLog ?? ((...args) => log.info(args.map(String).join(' ')));
    const encryptKey = account.encryptKey?.trim();
    if (!encryptKey) {
        throw new Error(`Feishu account "${accountId}" webhook mode requires encryptKey`);
    }
    const path = normalizeFeishuWebhookPath(account.config?.webhookPath, accountId);
    const dispatcher = new Lark.EventDispatcher({
        encryptKey,
        verificationToken: account.verificationToken ?? '',
    });
    dispatcher.register(handlers);
    // Durable admission is opt-in (`durableIngress: true`) and only when the
    // host exposes an ingress queue; otherwise the handler dispatches straight
    // to the EventDispatcher.
    const ingress = account.config?.durableIngress === true
        ? (0, ingress_1.createFeishuDurableIngress)({
            accountId,
            runtime: params.runtime,
            dispatcher,
            encryptKey,
            log: emit,
        })
        : null;
    // Started before the try so a start failure is not mislabelled as a route
    // registration failure; the finally below still stops it on any throw.
    ingress?.start();
    let unregisterRoute;
    try {
        const handler = createFeishuWebhookHandler({
            encryptKey,
            dispatcher,
            inFlightLimiter: (0, webhook_ingress_1.createWebhookInFlightLimiter)({
                maxInFlightPerKey: FEISHU_PRE_AUTH_MAX_IN_FLIGHT,
            }),
            inFlightKey: `webhook:${accountId}`,
            ...(ingress
                ? { invokeEnvelope: (envelope) => ingress.invokeWebhook(envelope, { needCheck: false }) }
                : {}),
        });
        unregisterRoute = (0, webhook_ingress_1.registerPluginHttpRoute)({
            path,
            auth: 'plugin',
            pluginId: FEISHU_PLUGIN_ID,
            // Account-scoped source: the host ignores accountId for route
            // ownership, so sharing one source would let a second account
            // silently reuse (and shadow) the first account's handler.
            source: `webhook:${accountId}`,
            accountId,
            handler,
            reuseExistingSameOwner: true,
            throwOnFailure: true,
        });
        emit(`feishu[${accountId}]: webhook registered at ${path}; point the Feishu callback URL at the Gateway route`);
        await (0, channel_outbound_1.waitUntilAbort)(abortSignal);
    }
    catch (err) {
        throw new Error(`Feishu account "${accountId}" failed to register webhook route "${path}": ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            `Each webhook account needs a distinct channels.feishu.webhookPath.`);
    }
    finally {
        unregisterRoute?.();
        await ingress?.stop();
    }
}
