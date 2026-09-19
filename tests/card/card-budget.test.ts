import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const builder = require("../../src/card/builder.js");

/**
 * Feishu card JSON 2.0 rejects a card with more than 200 elements (300305)
 * and rejects `card.update` payloads larger than 30KB (200860). A long
 * agentic run used to exceed both — the terminal update failed and the reply
 * was silently dropped (openclaw-lark-2 2026-09-20 incident).
 */

const ELEMENT_LIMIT = builder.CARD_ELEMENT_LIMIT as number;

function makeSteps(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: "exec_command",
    detail: `detail text ${i}`,
    status: "ok",
    resultBlock: { content: "x".repeat(5000), language: "text" },
  }));
}

describe("countCardElements", () => {
  it("counts nested text nodes, not just top-level elements", () => {
    const card = { elements: [{ tag: "div", text: { tag: "plain_text", content: "a" } }] };
    expect(builder.countCardElements(card)).toBe(2);
  });

  it("counts arrays recursively", () => {
    const card = {
      elements: [
        { tag: "div", text: { tag: "plain_text", content: "a" } },
        { tag: "markdown" },
      ],
    };
    expect(builder.countCardElements(card)).toBe(3);
  });
});

describe("tool-use panel element cap", () => {
  it("keeps a 61-step card under the 200-element limit", () => {
    const card = builder.buildCardContent("complete", {
      text: "y".repeat(1015),
      toolUseSteps: makeSteps(61),
      showToolUse: true,
      footer: { status: true, elapsed: true, model: true },
    });
    expect(builder.countCardElements(card)).toBeLessThanOrEqual(ELEMENT_LIMIT);
  });

  it("keeps the pre-answer streaming card under the limit too", () => {
    const card = builder.buildStreamingPreAnswerCard({
      steps: makeSteps(61),
      elapsedMs: 1000,
      showToolUse: true,
    });
    expect(builder.countCardElements(card)).toBeLessThanOrEqual(ELEMENT_LIMIT);
  });

  it("reports how many steps were dropped", () => {
    const steps = makeSteps(61);
    const card = builder.buildCardContent("complete", {
      text: "done",
      toolUseSteps: steps,
      showToolUse: true,
    });
    const panel = card.elements[0];
    const notice = panel.elements[panel.elements.length - 1];
    expect(notice.tag).toBe("div");
    expect(notice.text.content).toMatch(/not shown/);
    expect(notice.text.content).toMatch(/61 total/);
  });

  it("leaves small tool-use lists untouched", () => {
    const card = builder.buildCardContent("complete", {
      text: "done",
      toolUseSteps: makeSteps(3),
      showToolUse: true,
    });
    const panel = card.elements[0];
    const serialized = JSON.stringify(panel);
    expect(serialized).not.toMatch(/not shown/);
  });

  it("clips oversized tool result code blocks", () => {
    const card = builder.buildCardContent("complete", {
      text: "done",
      toolUseSteps: makeSteps(1),
      showToolUse: true,
    });
    expect(JSON.stringify(card)).toMatch(/truncated, 4600 more chars/);
  });
});

describe("buildBoundedCompleteCard", () => {
  it("returns the full card when it already fits", () => {
    const { card, truncatedText } = builder.buildBoundedCompleteCard({
      text: "short answer",
      showToolUse: false,
      footer: { status: true },
    });
    expect(truncatedText).toBe(false);
    expect(builder.estimateCardBytes(card)).toBeLessThan(30 * 1024);
  });

  it("clips a 55k-char reasoning panel instead of failing", () => {
    const { card, truncatedText } = builder.buildBoundedCompleteCard({
      text: "y".repeat(1015),
      reasoningText: "r".repeat(55000),
      toolUseSteps: makeSteps(61),
      showToolUse: true,
      footer: { status: true, elapsed: true, model: true },
    });
    expect(builder.estimateCardBytes(card)).toBeLessThanOrEqual(28 * 1024);
    expect(builder.countCardElements(card)).toBeLessThanOrEqual(ELEMENT_LIMIT);
    // The answer itself was preserved, so no out-of-band delivery is needed.
    expect(truncatedText).toBe(false);
  });

  it("flags truncatedText when the answer itself must be clipped", () => {
    const { card, truncatedText } = builder.buildBoundedCompleteCard({
      text: "z".repeat(60000),
      footer: { status: true },
    });
    expect(truncatedText).toBe(true);
    expect(builder.estimateCardBytes(card)).toBeLessThanOrEqual(28 * 1024);
  });

  it("drops the tool-use panel before truncating the answer", () => {
    const { card } = builder.buildBoundedCompleteCard({
      text: "answer",
      toolUseSteps: makeSteps(61),
      showToolUse: true,
    });
    expect(builder.estimateCardBytes(card)).toBeLessThanOrEqual(28 * 1024);
  });
});
