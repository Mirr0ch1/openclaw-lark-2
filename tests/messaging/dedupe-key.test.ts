import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveFeishuMessageDedupeKey,
} = require("../../src/messaging/inbound/dedupe-key.js");

function textEvent(overrides: Record<string, unknown> = {}) {
  return {
    sender: { sender_id: { open_id: "ou_a" } },
    message: {
      message_id: "om_1",
      message_type: "text",
      chat_id: "oc_1",
      create_time: "1700000000000",
      content: JSON.stringify({ text: "hi" }),
      ...overrides,
    },
  };
}

describe("resolveFeishuMessageDedupeKey", () => {
  it("is stable across a fresh message_id for the same logical message", () => {
    const a = resolveFeishuMessageDedupeKey(textEvent());
    const b = resolveFeishuMessageDedupeKey(textEvent({ message_id: "om_2" }));
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it("keeps distinct keys for genuinely different sends (new create_time)", () => {
    const a = resolveFeishuMessageDedupeKey(textEvent());
    const b = resolveFeishuMessageDedupeKey(
      textEvent({ message_id: "om_2", create_time: "1700000000001" }),
    );
    expect(a).not.toBe(b);
  });

  it("falls back to message_id when retry fields are missing", () => {
    expect(resolveFeishuMessageDedupeKey(textEvent({ create_time: undefined }))).toBe("om_1");
    expect(
      resolveFeishuMessageDedupeKey({ message: { message_id: "om_x", message_type: "image" } }),
    ).toBe("om_x");
  });

  it("scopes post messages by topic", () => {
    const a = resolveFeishuMessageDedupeKey(textEvent({ message_type: "post", root_id: "om_root" }));
    const b = resolveFeishuMessageDedupeKey(
      textEvent({ message_id: "om_2", message_type: "post", root_id: "om_root" }),
    );
    expect(a).toBe(b);
    expect(a).toContain("om_root");
  });
});
