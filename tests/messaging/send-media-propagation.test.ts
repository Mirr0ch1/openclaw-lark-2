import { describe, it, expect, afterEach } from "vitest";

// Require media first so actions.js shares the same exports object we patch.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const media = require("../../src/messaging/outbound/media.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuMessageActions } = require("../../src/messaging/outbound/actions.js");

const originalUpload = media.uploadAndSendMediaLark;
afterEach(() => {
  media.uploadAndSendMediaLark = originalUpload;
});

describe("direct `send` action — media upload failure propagation (C4b)", () => {
  it("rejects when a requested attachment cannot be uploaded (no ok:true fallback)", async () => {
    media.uploadAndSendMediaLark = async () => {
      throw new Error("boom: upload rejected");
    };
    await expect(
      feishuMessageActions.handleAction({
        action: "send",
        params: { to: "oc_1", media: "https://example.com/x.png" },
        cfg: {},
        accountId: undefined,
        toolContext: undefined,
      }),
    ).rejects.toThrow(/could not deliver the requested media attachment/);
  });

  it("still returns ok:true on a successful media send", async () => {
    media.uploadAndSendMediaLark = async () => ({ messageId: "om_ok", chatId: "oc_1" });
    const result = await feishuMessageActions.handleAction({
      action: "send",
      params: { to: "oc_1", media: "https://example.com/x.png" },
      cfg: {},
      accountId: undefined,
      toolContext: undefined,
    });
    const payload = result?.details ?? result?.content ?? result;
    expect(JSON.stringify(payload)).toContain("om_ok");
  });
});
