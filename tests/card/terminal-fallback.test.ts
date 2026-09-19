import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cardkit = require("../../src/card/cardkit.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StreamingCardController } = require("../../src/card/streaming-card-controller.js");

/**
 * Regression test for the 2026-09-20 incident: the terminal card update was
 * rejected by Feishu (300305 / 200860) and the error was swallowed, so the
 * user's answer never arrived. The controller must now fall back to a
 * plain-text delivery instead of losing the reply.
 */

const ALL_FALSE_FOOTER = {
  status: false,
  elapsed: false,
  tokens: false,
  cache: false,
  context: false,
  model: false,
};

function makeController(deliverFallbackText: (text: string) => Promise<void>) {
  const controller = new StreamingCardController({
    cfg: {},
    agentId: "main",
    sessionKey: "agent:main:feishu:direct:ou_x",
    accountId: "default",
    chatId: "ou_x",
    replyToMessageId: "om_in",
    replyInThread: false,
    toolUseDisplay: { showToolUse: false },
    resolvedFooter: ALL_FALSE_FOOTER,
    activityOnly: false,
    deliverFallbackText,
  });
  // Simulate an in-flight CardKit streaming card.
  controller.cardKit.cardMessageId = "om_card";
  controller.cardKit.originalCardKitCardId = "c1";
  controller.cardKit.cardKitSequence = 10;
  controller.phase = "streaming";
  controller.text.completedText = "final answer";
  controller.markFullyComplete();
  return controller;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(cardkit, "setCardStreamingMode").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("StreamingCardController terminal fallback", () => {
  it("delivers the answer as text when the final card update is rejected", async () => {
    const err = Object.assign(new Error("cardkit card.update FAILED: code=300305"), {
      code: 300305,
    });
    vi.spyOn(cardkit, "updateCardKitCard").mockRejectedValue(err);
    const deliverFallbackText = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(deliverFallbackText);

    await controller.onIdle();

    expect(deliverFallbackText).toHaveBeenCalledTimes(1);
    expect(deliverFallbackText).toHaveBeenCalledWith("final answer");
  });

  it("does not double-deliver when the card update succeeds", async () => {
    vi.spyOn(cardkit, "updateCardKitCard").mockResolvedValue(undefined);
    const deliverFallbackText = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(deliverFallbackText);

    await controller.onIdle();

    expect(deliverFallbackText).not.toHaveBeenCalled();
  });

  it("delivers the full answer when the card had to truncate it", async () => {
    vi.spyOn(cardkit, "updateCardKitCard").mockResolvedValue(undefined);
    const deliverFallbackText = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(deliverFallbackText);
    // 60k chars cannot fit in a 30KB card, so the answer is clipped on the card.
    controller.text.completedText = "z".repeat(60000);

    await controller.onIdle();

    expect(deliverFallbackText).toHaveBeenCalledTimes(1);
    expect(deliverFallbackText.mock.calls[0][0]).toHaveLength(60000);
  });

  it("does not fall back when a long-but-fitting answer is preserved", async () => {
    vi.spyOn(cardkit, "updateCardKitCard").mockResolvedValue(undefined);
    const deliverFallbackText = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(deliverFallbackText);
    controller.text.completedText = "z".repeat(20000);

    await controller.onIdle();

    expect(deliverFallbackText).not.toHaveBeenCalled();
  });

  it("survives a fallback delivery failure without throwing", async () => {
    vi.spyOn(cardkit, "updateCardKitCard").mockRejectedValue(new Error("boom"));
    const deliverFallbackText = vi.fn().mockRejectedValue(new Error("send failed"));
    const controller = makeController(deliverFallbackText);

    await expect(controller.onIdle()).resolves.toBeUndefined();
    expect(deliverFallbackText).toHaveBeenCalledTimes(1);
  });

  it("does not send the NO_REPLY sentinel through the fallback", async () => {
    vi.spyOn(cardkit, "updateCardKitCard").mockRejectedValue(new Error("boom"));
    const deliverFallbackText = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(deliverFallbackText);
    controller.text.completedText = "NO_REPLY";
    controller.text.accumulatedText = "";

    await controller.onIdle();

    expect(deliverFallbackText).not.toHaveBeenCalled();
  });
});
