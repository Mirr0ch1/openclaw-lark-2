import { describe, it, expect } from "vitest";
// CJS source modules load directly under vitest.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getLarkAccount, getLarkAccountIds } = require("../../src/core/accounts.js");

const OWNER = "ou_28ff6bf21a3ae11228df28995c608ae2";

/** Top-level section == implicit default bot base; `accounts.default` is an
 *  explicit override entry that must NOT be silently dropped. */
function cfgWithDefaultOverride() {
  return {
    channels: {
      feishu: {
        appId: "cli_top",
        appSecret: "top_secret",
        accounts: {
          default: {
            dmPolicy: "allowlist",
            groupPolicy: "open",
            allowFrom: [OWNER],
            groupAllowFrom: [OWNER],
          },
          plaud: {
            appId: "cli_plaud",
            appSecret: "plaud_secret",
            dmPolicy: "pairing",
            groupPolicy: "open",
            allowFrom: [OWNER],
          },
        },
      },
    },
  };
}

describe("accounts", () => {
  describe("getLarkAccount — default account override", () => {
    it("honors authorization fields declared under accounts.default", () => {
      const account = getLarkAccount(cfgWithDefaultOverride(), "default");
      // Regression: these were dropped because requestedId === 'default'
      // skipped the account override entirely, leaving default-account group
      // commands unauthorized (core read accounts.default, the plugin did not).
      expect(account.config.allowFrom).toEqual([OWNER]);
      expect(account.config.groupAllowFrom).toEqual([OWNER]);
      expect(account.config.groupPolicy).toBe("open");
      expect(account.config.dmPolicy).toBe("allowlist");
    });

    it("keeps top-level default-bot credentials when the default entry omits them", () => {
      const account = getLarkAccount(cfgWithDefaultOverride(), "default");
      expect(account.config.appId).toBe("cli_top");
      expect(account.config.appSecret).toBe("top_secret");
    });

    it("lets account-level fields override top-level for the default account", () => {
      const cfg = cfgWithDefaultOverride();
      cfg.channels.feishu.groupPolicy = "allowlist";
      const account = getLarkAccount(cfg, "default");
      expect(account.config.groupPolicy).toBe("open");
    });

    it("falls back to top-level when accounts.default is absent", () => {
      const cfg = cfgWithDefaultOverride();
      delete cfg.channels.feishu.accounts.default;
      const account = getLarkAccount(cfg, "default");
      expect(account.config.appId).toBe("cli_top");
      expect(account.config.allowFrom).toBeUndefined();
    });
  });

  describe("getLarkAccount — non-default accounts", () => {
    it("still merges a non-default account override", () => {
      const account = getLarkAccount(cfgWithDefaultOverride(), "plaud");
      expect(account.config.appId).toBe("cli_plaud");
      expect(account.config.dmPolicy).toBe("pairing");
      expect(account.config.allowFrom).toEqual([OWNER]);
    });
  });

  describe("getLarkAccountIds", () => {
    it("lists the explicit accounts including default", () => {
      expect(getLarkAccountIds(cfgWithDefaultOverride())).toEqual(["default", "plaud"]);
    });
  });
});
