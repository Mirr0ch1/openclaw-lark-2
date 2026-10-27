import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuOutbound } = require("../../src/messaging/outbound/outbound.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderPresentationForDelivery } = require("openclaw/plugin-sdk/interactive-runtime");

type Payload = Record<string, unknown>;

/** Read the code-built card out of a delivered payload, if there is one. */
function nativeCardOf(payload: Payload): unknown {
  const channelData = payload.channelData;
  if (!channelData || typeof channelData !== "object") {
    return undefined;
  }
  const feishuData = (channelData as { feishu?: { nativeCard?: unknown } }).feishu;
  return feishuData?.nativeCard;
}

const presentation = {
  blocks: [
    { type: "text", text: "Current verbose level: off." },
    {
      type: "buttons",
      buttons: [{ label: "on", action: { type: "command", command: "/verbose on" } }],
    },
  ],
};

/** The wrapper core builds around the adapter hook (`deliver-prepare.ts`). */
const handler = {
  presentationCapabilities: feishuOutbound.presentationCapabilities,
  renderPresentation: async (payload: Payload, sourcePresentation: unknown) =>
    feishuOutbound.renderPresentation({
      payload,
      presentation: payload.presentation,
      sourcePresentation,
      ctx: {},
    }),
};

describe("outbound renderPresentation", () => {
  it("carries the rest of the payload over instead of replacing it", async () => {
    // Core replaces the payload with whatever the hook returns, so media, the
    // reply target and any other channelData would be dropped otherwise.
    const rendered: Payload = await renderPresentationForDelivery(handler, {
      text: "fallback text",
      mediaUrls: ["https://example.com/a.png"],
      replyToId: "om_parent",
      location: { lat: 1, lon: 2 },
      channelData: { other: { keep: true } },
      presentation,
      presentationTextMode: "fallback",
    } as never);
    expect(rendered.mediaUrls).toEqual(["https://example.com/a.png"]);
    expect(rendered.replyToId).toBe("om_parent");
    expect(rendered.location).toEqual({ lat: 1, lon: 2 });
    expect(rendered.channelData).toMatchObject({ other: { keep: true } });
    expect(nativeCardOf(rendered)).toBeDefined();
  });

  it("drops the text only when it is the presentation's fallback copy", async () => {
    const fallback: Payload = await renderPresentationForDelivery(handler, {
      text: "fallback text",
      presentation,
      presentationTextMode: "fallback",
    } as never);
    expect(fallback.text).toBeUndefined();

    const extra: Payload = await renderPresentationForDelivery(handler, {
      text: "additional content",
      presentation,
    } as never);
    expect(extra.text).toBe("additional content");
  });

  it("keeps the presentation out of the delivered payload", async () => {
    const rendered: Payload = await renderPresentationForDelivery(handler, {
      text: "x",
      presentation,
    } as never);
    expect(rendered.presentation).toBeUndefined();
    expect(rendered.presentationTextMode).toBeUndefined();
  });
});
