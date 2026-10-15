import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeFeishuAllowEntry, resolveFeishuAllowlistMatch } = require("../../src/messaging/inbound/policy.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isMentionAll } = require("../../src/messaging/inbound/mention.js");

const allowed = (allowFrom: unknown[], senderId: string) =>
  resolveFeishuAllowlistMatch({ allowFrom: allowFrom as never, senderId }).allowed;

describe("normalizeFeishuAllowEntry", () => {
  it("strips provider and typed prefixes", () => {
    expect(normalizeFeishuAllowEntry("feishu:ou_x")).toBe("ou_x");
    expect(normalizeFeishuAllowEntry("lark:ou_x")).toBe("ou_x");
    expect(normalizeFeishuAllowEntry("user:ou_x")).toBe("ou_x");
    expect(normalizeFeishuAllowEntry("open_id:ou_x")).toBe("ou_x");
    expect(normalizeFeishuAllowEntry("chat:oc_x")).toBe("oc_x");
    expect(normalizeFeishuAllowEntry("LARK:USER:OU_X")).toBe("ou_x");
  });

  it("preserves the wildcard (including prefixed)", () => {
    expect(normalizeFeishuAllowEntry("*")).toBe("*");
    expect(normalizeFeishuAllowEntry("feishu:*")).toBe("*");
  });

  it("returns empty for blank input", () => {
    expect(normalizeFeishuAllowEntry("")).toBe("");
    expect(normalizeFeishuAllowEntry("   ")).toBe("");
    expect(normalizeFeishuAllowEntry(undefined)).toBe("");
  });
});

describe("resolveFeishuAllowlistMatch", () => {
  it("matches a bare id", () => {
    expect(allowed(["ou_x"], "ou_x")).toBe(true);
  });

  it("matches provider-prefixed and typed-prefixed entries (regression)", () => {
    expect(allowed(["feishu:ou_x"], "ou_x")).toBe(true);
    expect(allowed(["lark:ou_x"], "ou_x")).toBe(true);
    expect(allowed(["user:ou_x"], "ou_x")).toBe(true);
    expect(allowed(["open_id:ou_x"], "ou_x")).toBe(true);
  });

  it("honours a wildcard, bare or prefixed", () => {
    expect(allowed(["*"], "ou_anyone")).toBe(true);
    expect(allowed(["feishu:*"], "ou_anyone")).toBe(true);
  });

  it("does not match a different id", () => {
    expect(allowed(["ou_y"], "ou_x")).toBe(false);
    expect(allowed(["feishu:ou_y"], "ou_x")).toBe(false);
  });

  it("denies when the allowlist is empty", () => {
    expect(allowed([], "ou_x")).toBe(false);
  });
});

describe("isMentionAll (broadcast detection)", () => {
  it("matches @all and @_all keys (case-insensitive)", () => {
    expect(isMentionAll({ key: "@all" })).toBe(true);
    expect(isMentionAll({ key: "@_all" })).toBe(true);
    expect(isMentionAll({ key: "@ALL" })).toBe(true);
  });

  it("matches an id field equal to `all`", () => {
    expect(isMentionAll({ key: "@_user_1", id: { open_id: "all" } })).toBe(true);
    expect(isMentionAll({ key: "@_user_1", id: { user_id: "all" } })).toBe(true);
  });

  it("does not match an ordinary mention", () => {
    expect(isMentionAll({ key: "@_user_1", id: { open_id: "ou_a" } })).toBe(false);
  });
});
