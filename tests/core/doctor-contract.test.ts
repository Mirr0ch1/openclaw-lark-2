import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dc = require("../../src/core/doctor-contract.js");

const rule = dc.legacyConfigRules[0];

describe("feishu doctor contract — webhookPath", () => {
  it("leaves a canonical path untouched", () => {
    const cfg = { channels: { feishu: { appId: "cli_x", webhookPath: "/feishu/hook" } } };
    const out = dc.normalizeCompatibilityConfig({ cfg });
    expect(out.changes).toEqual([]);
    expect(out.config).toEqual(cfg);
    expect(rule.match(cfg.channels.feishu)).toBe(false);
  });

  it("normalizes a legacy root path and records a change", () => {
    const cfg = { channels: { feishu: { appId: "cli_x", webhookPath: "feishu//hook/" } } };
    expect(rule.match(cfg.channels.feishu)).toBe(true);
    const out = dc.normalizeCompatibilityConfig({ cfg });
    expect(out.config.channels.feishu.webhookPath).toBe("/feishu/hook");
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatch(/webhookPath/);
  });

  it("normalizes an account-level path", () => {
    const cfg = {
      channels: {
        feishu: {
          appId: "cli_x",
          accounts: { a1: { appId: "cli_a1", webhookPath: "hook" } },
        },
      },
    };
    expect(rule.match(cfg.channels.feishu)).toBe(true);
    const out = dc.normalizeCompatibilityConfig({ cfg });
    expect(out.config.channels.feishu.accounts.a1.webhookPath).toBe("/hook");
  });

  it("scopes an empty named-account path to that account, not the default", () => {
    const cfg = {
      channels: {
        feishu: {
          appId: "cli_x",
          accounts: { plaud: { appId: "cli_p", webhookPath: "" } },
        },
      },
    };
    const out = dc.normalizeCompatibilityConfig({ cfg });
    // The host ignores accountId in route ownership, so named accounts must not
    // collapse onto the default account's path.
    expect(out.config.channels.feishu.accounts.plaud.webhookPath).toBe("/feishu/webhook/plaud");
  });

  it("converges: the repaired config no longer matches the rule", () => {
    const cfg = { channels: { feishu: { appId: "cli_x", webhookPath: "feishu//hook/" } } };
    const once = dc.normalizeCompatibilityConfig({ cfg });
    expect(rule.match(once.config.channels.feishu)).toBe(false);
    const twice = dc.normalizeCompatibilityConfig({ cfg: once.config });
    expect(twice.changes).toEqual([]);
  });

  it("is a no-op without channels.feishu", () => {
    const cfg = { channels: {} };
    const out = dc.normalizeCompatibilityConfig({ cfg });
    expect(out.changes).toEqual([]);
    expect(out.config).toEqual(cfg);
  });
});
