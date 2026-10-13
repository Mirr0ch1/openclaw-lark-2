import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  withFeishuSendContext,
  captureFeishuSendAuthority,
} = require("../../src/messaging/outbound/send-context.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuSendRequest } = require("../../src/messaging/outbound/send-rate-limit.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PlatformMessageNotDispatchedError } = require("openclaw/plugin-sdk/error-runtime");

describe("send-context authority scope", () => {
  it("runs the send unchanged when the host provides no authority", async () => {
    expect(await withFeishuSendContext({}, async () => "ok")).toBe("ok");
  });

  it("exposes the authority only inside the scope", async () => {
    let inside: unknown = "unset";
    await withFeishuSendContext({ assertDirectAdapterHandoff: () => {} }, async () => {
      inside = captureFeishuSendAuthority();
    });
    expect(typeof inside).toBe("function");
    expect(captureFeishuSendAuthority()).toBeUndefined();
  });

  it("rejects with PlatformMessageNotDispatchedError when the turn is retired", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withFeishuSendContext({ signal: controller.signal }, async () => {
        captureFeishuSendAuthority()?.();
      }),
    ).rejects.toBeInstanceOf(PlatformMessageNotDispatchedError);
  });

  it("does not perform a physical send when the turn is retired", async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;
    await expect(
      withFeishuSendContext({ signal: controller.signal }, () =>
        feishuSendRequest(async () => {
          attempts += 1;
          return { code: 0 };
        }, "test.send"),
      ),
    ).rejects.toBeInstanceOf(PlatformMessageNotDispatchedError);
    expect(attempts).toBe(0);
  });

  it("passes the authority for a live turn", async () => {
    let dispatched = false;
    await withFeishuSendContext(
      { signal: new AbortController().signal, assertDirectAdapterHandoff: () => {} },
      async () => {
        captureFeishuSendAuthority()?.();
        dispatched = true;
      },
    );
    expect(dispatched).toBe(true);
  });
});
