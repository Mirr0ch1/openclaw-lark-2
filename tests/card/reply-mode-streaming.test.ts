import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveReplyMode,
  expandAutoMode,
  isFeishuStreamingEnabled,
} = require("../../src/card/reply-mode.js");

/**
 * P1-3 regression: the canonical `streaming` config is an object
 * (`{ mode: "partial" }`), matching @openclaw/feishu. The plugin used to only
 * accept boolean `true`, so a canonical config silently forced static mode.
 */
describe("streaming config object form", () => {
  it("enables on partial/true; disables on off/false/absent", () => {
    expect(isFeishuStreamingEnabled({ mode: "partial" })).toBe(true);
    expect(isFeishuStreamingEnabled(true)).toBe(true);
    // Object present without `mode` ⇒ official default "partial" ⇒ enabled.
    expect(isFeishuStreamingEnabled({})).toBe(true);
    expect(isFeishuStreamingEnabled({ chunkMode: "newline" })).toBe(true);
    expect(isFeishuStreamingEnabled({ mode: "off" })).toBe(false);
    expect(isFeishuStreamingEnabled(false)).toBe(false);
    expect(isFeishuStreamingEnabled(undefined)).toBe(false);
  });

  it("resolveReplyMode honors the object form (live config shape)", () => {
    expect(
      resolveReplyMode({ feishuCfg: { streaming: { mode: "partial" }, replyMode: { group: "streaming" } }, chatType: "group" }),
    ).toBe("streaming");
    expect(
      resolveReplyMode({ feishuCfg: { streaming: { mode: "off" }, replyMode: { group: "streaming" } }, chatType: "group" }),
    ).toBe("static");
  });

  it("expandAutoMode honors the object form", () => {
    expect(expandAutoMode({ mode: "auto", streaming: { mode: "partial" }, chatType: "p2p" })).toBe("streaming");
    expect(expandAutoMode({ mode: "auto", streaming: { mode: "off" }, chatType: "p2p" })).toBe("static");
  });
});
