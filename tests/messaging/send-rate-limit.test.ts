import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getFeishuSendRateLimitCode,
  getFeishuSendRateLimitCodeFromResponse,
  feishuSendRequest,
} = require("../../src/messaging/outbound/send-rate-limit.js");

describe("send rate-limit classification", () => {
  it("classifies thrown 429 and Feishu business codes", () => {
    expect(getFeishuSendRateLimitCode({ response: { status: 429 } })).toBe(429);
    expect(getFeishuSendRateLimitCode({ response: { status: 200, data: { code: 11232 } } })).toBe(11232);
    expect(getFeishuSendRateLimitCode({ response: { status: 200, data: { code: 230020 } } })).toBe(230020);
  });

  it("does not classify unrelated errors", () => {
    expect(getFeishuSendRateLimitCode({ response: { status: 400, data: { code: 99991672 } } })).toBeUndefined();
    expect(getFeishuSendRateLimitCode(new Error("boom"))).toBeUndefined();
    expect(getFeishuSendRateLimitCode(undefined)).toBeUndefined();
  });

  it("classifies a fulfilled rate-limit body", () => {
    expect(getFeishuSendRateLimitCodeFromResponse({ code: 11232 })).toBe(11232);
    expect(getFeishuSendRateLimitCodeFromResponse({ code: 0 })).toBeUndefined();
  });
});

describe("feishuSendRequest retry", () => {
  it("retries a fulfilled rate-limit body and then succeeds", async () => {
    let calls = 0;
    const result = await feishuSendRequest(async () => {
      calls += 1;
      return calls === 1 ? { code: 11232 } : { code: 0, data: { message_id: "om_ok" } };
    }, "test.send");
    expect(calls).toBe(2);
    expect(result.data.message_id).toBe("om_ok");
  });

  it("does not retry a non-rate-limit error", async () => {
    let calls = 0;
    const err = new Error("nope");
    await expect(
      feishuSendRequest(async () => {
        calls += 1;
        throw err;
      }, "test.send"),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  it("rethrows the original error after exhausting retries", async () => {
    let calls = 0;
    const err = Object.assign(new Error("rate"), { response: { status: 429 } });
    await expect(
      feishuSendRequest(async () => {
        calls += 1;
        throw err;
      }, "test.send"),
    ).rejects.toBe(err);
    expect(calls).toBe(3); // first attempt + 2 retries
  });
});
