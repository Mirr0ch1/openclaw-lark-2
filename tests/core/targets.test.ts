import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { detectIdType, resolveReceiveIdType } = require("../../src/core/targets.js");

/**
 * P1/P2 regression: align `resolveReceiveIdType` / `detectIdType` with
 * @openclaw/feishu. A bare tenant user id must map to `user_id` (not
 * `open_id`), and tenant ids may contain `-` / `_`.
 */
describe("targets — resolveReceiveIdType", () => {
  it("maps prefixed and bare ids like @openclaw/feishu", () => {
    expect(resolveReceiveIdType("chat:oc_x")).toBe("chat_id");
    expect(resolveReceiveIdType("group:oc_x")).toBe("chat_id");
    expect(resolveReceiveIdType("channel:oc_x")).toBe("chat_id");
    expect(resolveReceiveIdType("oc_x")).toBe("chat_id");
    expect(resolveReceiveIdType("open_id:ou_x")).toBe("open_id");
    expect(resolveReceiveIdType("ou_x")).toBe("open_id");
    expect(resolveReceiveIdType("user:ou_x")).toBe("open_id");
    expect(resolveReceiveIdType("dm:ou_x")).toBe("open_id");
    expect(resolveReceiveIdType("user:12345678")).toBe("user_id");
    expect(resolveReceiveIdType("dm:jsmith")).toBe("user_id");
    expect(resolveReceiveIdType("12345678")).toBe("user_id");
    expect(resolveReceiveIdType("a-b_c")).toBe("user_id");
  });
});

describe("targets — detectIdType", () => {
  it("accepts tenant ids containing -/_ and trims whitespace", () => {
    expect(detectIdType("a-b_c")).toBe("user_id");
    expect(detectIdType("  abc123  ")).toBe("user_id");
    expect(detectIdType("oc_x")).toBe("chat_id");
    expect(detectIdType("ou_x")).toBe("open_id");
  });

  it("returns null for non-ids and empties", () => {
    expect(detectIdType("has space")).toBeNull();
    expect(detectIdType("")).toBeNull();
    expect(detectIdType(undefined as unknown as string)).toBeNull();
  });
});
