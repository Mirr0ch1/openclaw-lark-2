import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuPlugin } = require("../../src/channel/plugin.js");

/**
 * The channel exposes its output-format rules through
 * `agentPrompt.inboundFormattingHints`, which OpenClaw injects into *every*
 * inbound turn (Message Context → `response_format`). This is the supported
 * always-on mechanism — the old `feishu-channel-rules` skill used an
 * `alwaysActive` frontmatter flag that OpenClaw does not recognize, so the
 * rules were effectively never guaranteed to reach the model.
 */
describe("feishu agentPrompt formatting hints", () => {
  it("exposes inboundFormattingHints with a markup tag and rules", () => {
    const hints = feishuPlugin.agentPrompt.inboundFormattingHints({ cfg: {} });
    expect(hints).toBeTruthy();
    expect(typeof hints.text_markup).toBe("string");
    expect(hints.text_markup.length).toBeGreaterThan(0);
    expect(Array.isArray(hints.rules)).toBe(true);
    expect(hints.rules.length).toBeGreaterThan(0);
    for (const rule of hints.rules) {
      expect(typeof rule).toBe("string");
      expect(rule.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the existing message tool hints", () => {
    const hints = feishuPlugin.agentPrompt.messageToolHints({ cfg: {} });
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.length).toBeGreaterThan(0);
  });
});
