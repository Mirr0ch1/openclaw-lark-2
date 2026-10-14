import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  assertFeishuSendSuccess,
  feishuSendRequest,
} = require("../../src/messaging/outbound/send-rate-limit.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWithMessageUnavailableGuard } = require("../../src/core/message-unavailable.js");

/**
 * P0 regression: the Lark SDK *resolves* (does not reject) responses whose body
 * carries a non-zero business `code`. Sends must assert `code === 0`, otherwise
 * a rejected send is reported as success with an empty `message_id`.
 */
describe("outbound send business-code assertion", () => {
  it("passes a fulfilled success body (and tolerates a non-object)", () => {
    expect(() => assertFeishuSendSuccess({ code: 0, msg: "ok" }, "t")).not.toThrow();
    expect(() => assertFeishuSendSuccess(undefined, "t")).not.toThrow();
  });

  it("throws on a fulfilled non-zero business code, keeping it inspectable", () => {
    let err: any;
    try {
      assertFeishuSendSuccess({ code: 200860, msg: "content too large" }, "im.message.create(post)");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // Downstream classifiers (message-unavailable guard) read `code` and
    // `response.data.code`, so both must be attached.
    expect(err.code).toBe(200860);
    expect(err.response?.data?.code).toBe(200860);
    expect(String(err.message)).toContain("200860");
  });

  it("feishuSendRequest rejects instead of returning a failed send", async () => {
    await expect(
      feishuSendRequest(async () => ({ code: 99991672, msg: "no scope" }), "im.message.create(post)"),
    ).rejects.toMatchObject({ code: 99991672 });
  });

  it("feishuSendRequest still resolves a real success", async () => {
    const r = await feishuSendRequest(async () => ({ code: 0, data: { message_id: "om_1" } }), "t");
    expect(r.data.message_id).toBe("om_1");
  });

  it("still retries rate-limit codes before asserting", async () => {
    let calls = 0;
    const r = await feishuSendRequest(async () => {
      calls += 1;
      return calls === 1 ? { code: 11232 } : { code: 0, data: { message_id: "om_ok" } };
    }, "t");
    expect(calls).toBe(2);
    expect(r.data.message_id).toBe("om_ok");
  });

  it("coerces a numeric-string business code", () => {
    expect(() => assertFeishuSendSuccess({ code: "230011", msg: "withdrawn" }, "t")).toThrow(/230011/);
  });

  it("the thrown business error is still recognized by the message-unavailable guard", async () => {
    let coded: any;
    try {
      assertFeishuSendSuccess({ code: 230011, msg: "message withdrawn" }, "im.message.reply(post)");
    } catch (e) {
      coded = e;
    }
    await expect(
      runWithMessageUnavailableGuard({
        messageId: "om_e2e_withdrawn_1",
        operation: "im.message.reply(post)",
        fn: async () => {
          throw coded;
        },
      }),
    ).rejects.toMatchObject({ name: "MessageUnavailableError", apiCode: 230011 });
  });

  it("a non-terminal business error is rethrown unchanged (not marked unavailable)", async () => {
    let coded: any;
    try {
      assertFeishuSendSuccess({ code: 99991672, msg: "no scope" }, "t");
    } catch (e) {
      coded = e;
    }
    await expect(
      runWithMessageUnavailableGuard({
        messageId: "om_e2e_scope_1",
        operation: "t",
        fn: async () => {
          throw coded;
        },
      }),
    ).rejects.toMatchObject({ code: 99991672 });
  });
});
