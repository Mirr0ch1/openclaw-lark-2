import { describe, it, expect, afterEach } from "vitest";

// Require deliver first so outbound.js shares the exports object we patch.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deliver = require("../../src/messaging/outbound/deliver.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuOutbound } = require("../../src/messaging/outbound/outbound.js");

const originals = {
  sendTextLark: deliver.sendTextLark,
  sendMediaLark: deliver.sendMediaLark,
};
afterEach(() => {
  deliver.sendTextLark = originals.sendTextLark;
  deliver.sendMediaLark = originals.sendMediaLark;
});

function collector() {
  const calls: unknown[] = [];
  return { calls, onDeliveryResult: async (r: unknown) => void calls.push(r) };
}

describe("outbound adapter — onDeliveryResult forwarding (C1)", () => {
  it("reports the result for a successful sendText", async () => {
    deliver.sendTextLark = async () => ({ messageId: "om_x", chatId: "oc_1" });
    const { calls, onDeliveryResult } = collector();
    const result = await feishuOutbound.sendText({
      cfg: {},
      to: "oc_1",
      text: "hi",
      onDeliveryResult,
    });
    expect(result.messageId).toBe("om_x");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ channel: "feishu", messageId: "om_x", chatId: "oc_1" });
  });

  it("reports the result for a successful sendMedia", async () => {
    deliver.sendMediaLark = async () => ({ messageId: "om_media", chatId: "oc_1" });
    const { calls, onDeliveryResult } = collector();
    const result = await feishuOutbound.sendMedia({
      cfg: {},
      to: "oc_1",
      mediaUrl: "https://example.com/a.png",
      onDeliveryResult,
    });
    expect(result.messageId).toBe("om_media");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ channel: "feishu", messageId: "om_media", chatId: "oc_1" });
  });

  it("reports the caption and the media as separate deliveries", async () => {
    deliver.sendTextLark = async () => ({ messageId: "om_caption", chatId: "oc_1" });
    deliver.sendMediaLark = async () => ({ messageId: "om_media", chatId: "oc_1" });
    const { calls, onDeliveryResult } = collector();
    await feishuOutbound.sendMedia({
      cfg: {},
      to: "oc_1",
      text: "caption",
      mediaUrl: "https://example.com/a.png",
      onDeliveryResult,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ messageId: "om_caption" });
    expect(calls[1]).toMatchObject({ messageId: "om_media" });
  });

  it("carries a media warning into the reported result meta", async () => {
    deliver.sendMediaLark = async () => ({
      messageId: "om_media",
      chatId: "oc_1",
      warning: "upload failed, link sent",
    });
    const { calls, onDeliveryResult } = collector();
    await feishuOutbound.sendMedia({
      cfg: {},
      to: "oc_1",
      mediaUrl: "https://example.com/a.png",
      onDeliveryResult,
    });
    expect(calls[0]).toMatchObject({ meta: { warnings: ["upload failed, link sent"] } });
  });

  it("does not fail the send when no onDeliveryResult is provided", async () => {
    deliver.sendTextLark = async () => ({ messageId: "om_x", chatId: "oc_1" });
    const result = await feishuOutbound.sendText({ cfg: {}, to: "oc_1", text: "hi" });
    expect(result.messageId).toBe("om_x");
  });

  it("does not fail an already-delivered send when onDeliveryResult throws", async () => {
    deliver.sendTextLark = async () => ({ messageId: "om_x", chatId: "oc_1" });
    const result = await feishuOutbound.sendText({
      cfg: {},
      to: "oc_1",
      text: "hi",
      onDeliveryResult: async () => {
        throw new Error("core callback boom");
      },
    });
    expect(result.messageId).toBe("om_x");
  });

  it("does not report for synthetic (dropped) targets", async () => {
    const { calls, onDeliveryResult } = collector();
    await feishuOutbound.sendText({
      cfg: {},
      to: "synthetic:vc-meeting-invited:123",
      text: "hi",
      onDeliveryResult,
    });
    expect(calls).toHaveLength(0);
  });
});
