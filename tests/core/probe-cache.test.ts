import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");

const FIVE_MIN = 5 * 60 * 1000;

function makeClient() {
  return LarkClient.fromCredentials({
    appId: "cli_probe",
    appSecret: "sec",
    accountId: "probe-test",
  });
}

describe("LarkClient.probe caching", () => {
  it("serves a fresh error from cache", async () => {
    const client = makeClient();
    client._lastProbeResult = { ok: false, appId: "cli_probe", error: "boom" };
    client._lastProbeAt = Date.now();
    const result = await client.probe({ maxAgeMs: FIVE_MIN });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("re-probes a stale error after the 1-minute error TTL", async () => {
    const client = makeClient();
    client._lastProbeResult = { ok: false, appId: "cli_probe", error: "boom" };
    client._lastProbeAt = Date.now() - 90 * 1000; // older than PROBE_ERROR_TTL_MS
    Object.defineProperty(client, "sdk", {
      configurable: true,
      get: () => ({
        request: async () => ({
          code: 0,
          data: { pingBotInfo: { botID: "ou_bot", botName: "Bot" } },
        }),
      }),
    });
    const result = await client.probe({ maxAgeMs: FIVE_MIN });
    expect(result.ok).toBe(true);
    expect(result.botOpenId).toBe("ou_bot");
  });

  it("serves a success from cache for the full window", async () => {
    const client = makeClient();
    client._lastProbeResult = { ok: true, appId: "cli_probe", botOpenId: "ou_bot" };
    client._lastProbeAt = Date.now() - 4 * 60 * 1000;
    const result = await client.probe({ maxAgeMs: FIVE_MIN });
    expect(result.ok).toBe(true);
    expect(result.botOpenId).toBe("ou_bot");
  });
});
