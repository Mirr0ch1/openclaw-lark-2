import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
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
    expect(resolvePayloadCardDelivery({ text: "plain" }).card).toBeUndefined();
    expect(resolvePayloadCardDelivery({ text: "plain" }).text).toBe("plain");
  });

  it("leaves an ask_user question to its own clickable option card", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      text: "Pick an option",
      channelData: { askUser: { questionId: "q1" } },
      presentation: { blocks: [{ type: "buttons", buttons: [{ label: "a" }] }] },
    });
    expect(resolved.card).toBeUndefined();
    expect(resolved.text).toBe("Pick an option");
  });

  it("falls back to the presentation text when the card does not fit", () => {
    // A presentation far past Feishu's 30 KB card budget cannot become a card.
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: { blocks: [{ type: "text", text: "x".repeat(40000) }] },
    });
    expect(resolved.card).toBeUndefined();
    expect(resolved.text.length).toBeGreaterThan(0);
  });

  it("downgrades a chart to text instead of dropping it", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: {
        blocks: [
          {
            type: "chart",
            chartType: "pie",
            title: "Spend",
            segments: [{ label: "tools", value: 3 }],
          },
        ],
      },
    });
    const card = resolved.card as { body: { elements: Array<{ tag: string; content?: string }> } };
    const markdown = card.body.elements.filter((element) => element.tag === "markdown");
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown.map((element) => element.content ?? "").join(" ")).toContain("Spend");
  });

  it("never renders a disabled control as a live button", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: {
        blocks: [
          {
            type: "buttons",
            buttons: [
              { label: "off", disabled: true, action: { type: "command", command: "/x off" } },
              { label: "on", action: { type: "command", command: "/x on" } },
            ],
          },
        ],
      },
    });
    const card = resolved.card as {
      body: {
        elements: Array<{
          tag: string;
          content?: string;
          columns?: Array<{ elements: Array<{ text: { content: string } }> }>;
        }>;
      };
    };
    const labels = card.body.elements
      .filter((element) => element.tag === "column_set")
      .flatMap((element) => (element.columns ?? []).flatMap((column) => column.elements.map((button) => button.text.content)));
    expect(labels).toEqual(["on"]);
  });

  it("splits an over-long text block into the declared limit", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: { blocks: [{ type: "text", text: "y".repeat(9000) }] },
    });
    const card = resolved.card as { body: { elements: Array<{ tag: string; content?: string }> } };
    const lengths = card.body.elements
      .filter((element) => element.tag === "markdown")
      .map((element) => (element.content ?? "").length);
    expect(lengths.length).toBeGreaterThan(1);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(4000);
  });

  it("truncates an over-long button label", () => {
    const resolved: Resolved = resolvePayloadCardDelivery({
      presentation: {
        blocks: [
          {
            type: "buttons",
            buttons: [
              { label: "L" + "z".repeat(80), action: { type: "command", command: "/x" } },
            ],
          },
        ],
      },
    });
    const card = resolved.card as {
      body: {
        elements: Array<{
          tag: string;
          columns?: Array<{ elements: Array<{ text: { content: string } }> }>;
        }>;
      };
    };
    const labels = card.body.elements
      .filter((element) => element.tag === "column_set")
      .flatMap((element) => (element.columns ?? []).flatMap((column) => column.elements.map((button) => button.text.content)));
    expect(labels).toHaveLength(1);
    expect((labels[0] ?? "").length).toBeLessThanOrEqual(30);
  });
});
