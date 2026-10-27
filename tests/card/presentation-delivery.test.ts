import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolvePayloadCard,
  resolvePayloadCardDelivery,
} = require("../../src/card/presentation-delivery.js");

type Resolved = { card?: Record<string, unknown>; text: string };

describe("payload → Feishu card resolution", () => {
  it("prefers a code-built card and keeps the payload text beside it", () => {
    const card = { schema: "2.0", body: { elements: [] } };
    const resolved: Resolved = resolvePayloadCardDelivery({
      text: "hello",
      channelData: { feishu: { nativeCard: card } },
    });
    expect(resolved.card).toBe(card);
    expect(resolved.text).toBe("hello");
  });

  it("embeds the prompt text into a plugin-native button card", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      text: "Select a provider:",
      channelData: { feishu: { buttons: [{ label: "openai", prompt: "/models openai" }] } },
    });
    expect(resolved.card).toBeDefined();
    // The card carries the text, so nothing is sent alongside it.
    expect(resolved.text).toBe("");
  });

  it("drops the text when it is the presentation's fallback copy", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      text: "Current verbose level: off.",
      presentationTextMode: "fallback",
      presentation: { blocks: [{ type: "text", text: "Current verbose level: off." }] },
    });
    expect(resolved.card).toBeDefined();
    expect(resolved.text).toBe("");
  });

  it("keeps the text when it is additional content", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      text: "extra context",
      presentation: { blocks: [{ type: "text", text: "card body" }] },
    });
    expect(resolved.card).toBeDefined();
    expect(resolved.text).toBe("extra context");
  });

  it("returns no card for a payload with nothing renderable", () => {
    expect(resolvePayloadCard({ text: "plain" })).toBeUndefined();
    expect(resolvePayloadCardDelivery({ text: "plain" }).text).toBe("plain");
  });

  it("falls back to the presentation text when the card does not fit", () => {
    // A presentation far past Feishu's 30 KB card budget cannot become a card.
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: { blocks: [{ type: "text", text: "x".repeat(40000) }] },
    });
    expect(resolved.card).toBeUndefined();
    expect(resolved.text.length).toBeGreaterThan(0);
  });
});
