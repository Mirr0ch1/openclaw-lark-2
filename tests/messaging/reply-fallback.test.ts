import { describe, it, expect, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isWithdrawnReplyError, withReplyFallback } = require("../../src/messaging/outbound/reply-fallback.js");

const withdrawnByName = () => {
  const err = new Error("message unavailable");
  err.name = "MessageUnavailableError";
  return err;
};
const withdrawnByCode = () => Object.assign(new Error("withdrawn"), { code: 230011 });
const deletedByCode = () => Object.assign(new Error("deleted"), { code: 231003 });
const withdrawnByNestedCode = () =>
  Object.assign(new Error("axios"), { response: { data: { code: 230011 } } });
const withdrawnByCause = () => new Error("outer", { cause: withdrawnByCode() });

describe("isWithdrawnReplyError", () => {
  it("recognises MessageUnavailableError by name", () => {
    expect(isWithdrawnReplyError(withdrawnByName())).toBe(true);
  });

  it("recognises terminal Feishu codes (withdrawn / deleted)", () => {
    expect(isWithdrawnReplyError(withdrawnByCode())).toBe(true);
    expect(isWithdrawnReplyError(deletedByCode())).toBe(true);
    expect(isWithdrawnReplyError(withdrawnByNestedCode())).toBe(true);
  });

  it("walks the cause chain", () => {
    expect(isWithdrawnReplyError(withdrawnByCause())).toBe(true);
  });

  it("rejects unrelated / non-object errors", () => {
    expect(isWithdrawnReplyError(new Error("boom"))).toBe(false);
    expect(isWithdrawnReplyError(undefined)).toBe(false);
    expect(isWithdrawnReplyError("string")).toBe(false);
  });
});

describe("withReplyFallback", () => {
  it("returns the reply result and never creates when the reply succeeds", async () => {
    const attemptCreate = vi.fn();
    const attemptReply = vi.fn().mockResolvedValue({ messageId: "om_reply" });
    const out = await withReplyFallback({ replyInThread: false, attemptReply, attemptCreate });
    expect(out).toEqual({ messageId: "om_reply" });
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it("falls back to a top-level create when the reply target was withdrawn", async () => {
    const attemptCreate = vi.fn().mockResolvedValue({ messageId: "om_new" });
    const attemptReply = vi.fn().mockRejectedValue(withdrawnByCode());
    const out = await withReplyFallback({ replyInThread: false, attemptReply, attemptCreate });
    expect(out).toEqual({ messageId: "om_new" });
    expect(attemptCreate).toHaveBeenCalledTimes(1);
  });

  it("does NOT fall back when the reply is thread-scoped (unsafe to de-thread)", async () => {
    const attemptCreate = vi.fn();
    const attemptReply = vi.fn().mockRejectedValue(withdrawnByCode());
    await expect(
      withReplyFallback({ replyInThread: true, attemptReply, attemptCreate }),
    ).rejects.toThrow("withdrawn");
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it("rethrows non-withdrawn errors without falling back", async () => {
    const attemptCreate = vi.fn();
    const attemptReply = vi.fn().mockRejectedValue(new Error("network blip"));
    await expect(
      withReplyFallback({ replyInThread: false, attemptReply, attemptCreate }),
    ).rejects.toThrow("network blip");
    expect(attemptCreate).not.toHaveBeenCalled();
  });
});
