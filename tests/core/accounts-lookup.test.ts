import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getLarkAccount, getDefaultLarkAccountId } = require("../../src/core/accounts.js");

/**
 * P1-7 / P2 regressions in account resolution:
 *  - account keys were indexed with a normalized (lower-cased) id, so a key
 *    like `ProdAO` silently fell back to the default app's credentials;
 *  - the channel-level kill switch was ignored;
 *  - `channels.feishu.defaultAccount` was ignored.
 */
describe("accounts — normalized lookup, kill switch, defaultAccount", () => {
  const cfgWithUpperKey = () => ({
    channels: {
      feishu: {
        appId: "baseApp",
        appSecret: "baseSec",
        accounts: { ProdAO: { appId: "prodApp", appSecret: "prodSec", domain: "lark" } },
      },
    },
  });

  it("resolves an account whose configured key has uppercase letters", () => {
    const byRaw = getLarkAccount(cfgWithUpperKey(), "ProdAO");
    expect(byRaw.appId).toBe("prodApp");
    expect(byRaw.brand).toBe("lark");

    const byNormalized = getLarkAccount(cfgWithUpperKey(), "prodao");
    expect(byNormalized.appId).toBe("prodApp");
  });

  it("channel-level enabled:false disables every account", () => {
    const cfg = { channels: { feishu: { enabled: false, appId: "a", appSecret: "b" } } };
    expect(getLarkAccount(cfg, "default").enabled).toBe(false);
  });

  it("an account may still opt out via its own enabled:false", () => {
    const cfg = { channels: { feishu: { appId: "a", appSecret: "b", accounts: { x: { enabled: false } } } } };
    expect(getLarkAccount(cfg, "x").enabled).toBe(false);
  });

  it("honors channels.feishu.defaultAccount", () => {
    const cfg = {
      channels: {
        feishu: {
          defaultAccount: "hw",
          accounts: { plaud: { appId: "a", appSecret: "b" }, hw: { appId: "c", appSecret: "d" } },
        },
      },
    };
    expect(getDefaultLarkAccountId(cfg)).toBe("hw");
  });

  it("falls back to the first id when no defaultAccount is set", () => {
    const cfg = { channels: { feishu: { appId: "a", appSecret: "b" } } };
    expect(getDefaultLarkAccountId(cfg)).toBe("default");
  });
});
