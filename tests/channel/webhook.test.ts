import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  normalizeFeishuWebhookPath,
  isFeishuWebhookTimestampFresh,
  computeFeishuWebhookSignature,
  isFeishuWebhookSignatureValid,
  createFeishuWebhookHandler,
} = require("../../src/channel/webhook.js");

const KEY = "enc-key";

function makeReq(body: string, headers: Record<string, string> = {}) {
  const req: any = Readable.from([Buffer.from(body, "utf8")]);
  req.method = "POST";
  req.headers = { "content-type": "application/json", ...headers };
  // The core webhook guards/body readers inspect and subscribe to the
  // connection, so the doubles need event-emitter semantics.
  req.socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    remoteAddress: "127.0.0.1",
  });
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
  };
  return req;
}

function makeRes() {
  const res: any = Object.assign(new EventEmitter(), {
    statusCode: 0,
    headers: {},
    body: "",
    headersSent: false,
  });
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res.statusCode = code;
    if (headers) Object.assign(res.headers, headers);
    return res;
  };
  res.end = (b?: string) => {
    res.body = b ?? "";
    res.headersSent = true;
    res.emit("finish");
  };
  res.destroy = () => {};
  return res;
}

function signedHeaders(body: string, ts = Math.floor(Date.now() / 1000), nonce = "n1") {
  const signature = computeFeishuWebhookSignature({
    timestamp: ts,
    nonce,
    encryptKey: KEY,
    rawBody: body,
  });
  return {
    "x-lark-request-timestamp": String(ts),
    "x-lark-request-nonce": nonce,
    "x-lark-signature": signature,
  };
}

describe("feishu webhook — pure helpers", () => {
  it("normalizes configured paths", () => {
    expect(normalizeFeishuWebhookPath(undefined)).toBe("/feishu/webhook");
    expect(normalizeFeishuWebhookPath("feishu//hook/")).toBe("/feishu/hook");
    expect(normalizeFeishuWebhookPath("/a/b")).toBe("/a/b");
  });

  it("defaults named accounts to a distinct account-scoped path", () => {
    // The host ignores accountId for route ownership, so two webhook accounts
    // on one path would silently share a handler.
    expect(normalizeFeishuWebhookPath(undefined, "plaud")).toBe("/feishu/webhook/plaud");
    expect(normalizeFeishuWebhookPath(undefined, "default")).toBe("/feishu/webhook");
    // An explicit path is honoured verbatim for any account.
    expect(normalizeFeishuWebhookPath("/custom", "plaud")).toBe("/custom");
  });

  it("accepts second- and millisecond-level fresh timestamps, rejects stale", () => {
    const now = Date.now();
    expect(isFeishuWebhookTimestampFresh(String(Math.floor(now / 1000)), now)).toBe(true);
    expect(isFeishuWebhookTimestampFresh(String(now), now)).toBe(true);
    expect(isFeishuWebhookTimestampFresh(String(now - 2 * 60 * 60 * 1000), now)).toBe(false);
    expect(isFeishuWebhookTimestampFresh("nope", now)).toBe(false);
  });

  it("validates signatures and rejects tampered or stale ones", () => {
    const body = JSON.stringify({ hello: "world" });
    const headers = signedHeaders(body);
    expect(isFeishuWebhookSignatureValid({ headers, rawBody: body, encryptKey: KEY })).toBe(true);
    expect(isFeishuWebhookSignatureValid({ headers, rawBody: `${body}x`, encryptKey: KEY })).toBe(false);
    expect(isFeishuWebhookSignatureValid({ headers, rawBody: body, encryptKey: "other" })).toBe(false);
    const stale = signedHeaders(body, Math.floor(Date.now() / 1000) - 7200);
    expect(isFeishuWebhookSignatureValid({ headers: stale, rawBody: body, encryptKey: KEY })).toBe(false);
  });
});

describe("feishu webhook handler", () => {
  it("echoes the url_verification challenge", async () => {
    const body = JSON.stringify({ challenge: "abc", type: "url_verification", token: "t" });
    const handler = createFeishuWebhookHandler({
      encryptKey: KEY,
      dispatcher: { invoke: async () => ({}) },
    });
    const res = makeRes();
    await handler(makeReq(body, signedHeaders(body)), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).challenge).toBe("abc");
  });

  it("rejects an unsigned request", async () => {
    const body = JSON.stringify({ a: 1 });
    const handler = createFeishuWebhookHandler({
      encryptKey: KEY,
      dispatcher: { invoke: async () => ({}) },
    });
    const res = makeRes();
    await handler(makeReq(body, {}), res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-JSON content type before reading the body", async () => {
    const body = JSON.stringify({ a: 1 });
    const handler = createFeishuWebhookHandler({
      encryptKey: KEY,
      dispatcher: { invoke: async () => ({}) },
    });
    const res = makeRes();
    await handler(makeReq(body, { ...signedHeaders(body), "content-type": "text/plain" }), res);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).not.toBe(401); // rejected by the pre-auth guard, not the signature
  });

  // NOTE: the oversized-body (413) and read-timeout (408) responses come from
  // core's `readWebhookBodyOrReject`; they need a real socket to exercise and
  // are covered by core, not by this plugin's logic.

  it("dispatches a correctly signed event", async () => {
    const body = JSON.stringify({ header: { event_type: "im.message.receive_v1" }, event: {} });
    let invocations = 0;
    const handler = createFeishuWebhookHandler({
      encryptKey: KEY,
      dispatcher: {
        invoke: async () => {
          invocations += 1;
          return {};
        },
      },
    });
    const res = makeRes();
    await handler(makeReq(body, signedHeaders(body)), res);
    expect(invocations).toBe(1);
    expect(res.statusCode).toBe(200);
  });
});
