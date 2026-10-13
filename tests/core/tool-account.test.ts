import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Type } = require("@sinclair/typebox");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveFeishuToolAccount,
  withFeishuToolCallParams,
  getFeishuToolCallParams,
  withAccountIdToolParam,
} = require("../../src/core/tool-account.js");

function makeConfig(extra: Record<string, unknown> = {}) {
  return {
    channels: {
      feishu: {
        appId: "cli_default",
        appSecret: "sec_default",
        accounts: {
          a1: { appId: "cli_a1", appSecret: "sec_a1" },
          a2: { appId: "cli_a2", appSecret: "sec_a2", enabled: false },
          a3: { appId: "cli_a3" }, // appSecret missing -> not configured
        },
        ...extra,
      },
    },
  };
}

describe("resolveFeishuToolAccount", () => {
  it("honours an explicit accountId", () => {
    const account = resolveFeishuToolAccount({
      config: makeConfig(),
      executeParams: { accountId: "a1" },
    });
    expect(account.accountId).toBe("a1");
    expect(account.appId).toBe("cli_a1");
  });

  it("throws on an unknown accountId instead of silently falling back", () => {
    expect(() =>
      resolveFeishuToolAccount({ config: makeConfig(), executeParams: { accountId: "nope" } }),
    ).toThrow(/Unknown Feishu account/);
  });

  it("throws when the explicit account is disabled", () => {
    expect(() =>
      resolveFeishuToolAccount({ config: makeConfig(), executeParams: { accountId: "a2" } }),
    ).toThrow(/disabled/);
  });

  it("throws when the explicit account is not configured", () => {
    // Account overrides inherit the top-level appSecret, so drop the top-level
    // credentials to model a genuinely unconfigured account.
    const config = {
      channels: {
        feishu: {
          accounts: {
            a1: { appId: "cli_a1", appSecret: "sec_a1" },
            a3: { appId: "cli_a3" },
          },
        },
      },
    };
    expect(() =>
      resolveFeishuToolAccount({ config, executeParams: { accountId: "a3" } }),
    ).toThrow(/not configured/);
  });

  it("prefers the contextual account when no accountId is given", () => {
    const account = resolveFeishuToolAccount({ config: makeConfig(), defaultAccountId: "a1" });
    expect(account.accountId).toBe("a1");
  });

  it("skips a disabled contextual account and falls back to a usable one", () => {
    const account = resolveFeishuToolAccount({ config: makeConfig(), defaultAccountId: "a2" });
    expect(account.appId).toBe("cli_default");
  });

  it("uses channels.feishu.defaultAccount as a routing preference", () => {
    const account = resolveFeishuToolAccount({
      config: makeConfig({ defaultAccount: "a1" }),
    });
    expect(account.accountId).toBe("a1");
  });

  it("falls back to the first enabled account", () => {
    const account = resolveFeishuToolAccount({ config: makeConfig() });
    expect(account.appId).toBe("cli_default");
  });

  it("throws when no usable account exists", () => {
    expect(() =>
      resolveFeishuToolAccount({ config: { channels: { feishu: { accounts: {} } } } }),
    ).toThrow(/No enabled Feishu account/);
  });
});

describe("per-tool-call param scope", () => {
  it("exposes params synchronously and across awaits", async () => {
    const seen = await withFeishuToolCallParams({ accountId: "a1" }, async () => {
      expect(getFeishuToolCallParams()).toEqual({ accountId: "a1" });
      await Promise.resolve();
      return getFeishuToolCallParams();
    });
    expect(seen).toEqual({ accountId: "a1" });
  });

  it("is undefined outside a scope", () => {
    expect(getFeishuToolCallParams()).toBeUndefined();
  });
});

describe("withAccountIdToolParam", () => {
  it("adds an optional accountId to every union member without mutating the input", () => {
    const union = Type.Union([
      Type.Object({ action: Type.Literal("search"), query: Type.String() }),
      Type.Object({ action: Type.Literal("get"), chat_id: Type.String() }),
    ]);
    const augmented = withAccountIdToolParam(union);
    expect(augmented).not.toBe(union);
    expect(union.anyOf[0].properties.accountId).toBeUndefined();
    for (const member of augmented.anyOf) {
      expect(member.properties.accountId).toBeDefined();
      expect(member.required).not.toContain("accountId");
    }
  });

  it("is idempotent and leaves non-object schemas untouched", () => {
    const single = Type.Object({ action: Type.Literal("a") });
    const once = withAccountIdToolParam(single);
    const twice = withAccountIdToolParam(once);
    expect(Object.keys(twice.properties).filter((k: string) => k === "accountId")).toHaveLength(1);
    expect(withAccountIdToolParam("not-a-schema")).toBe("not-a-schema");
    expect(withAccountIdToolParam(undefined)).toBeUndefined();
  });
});
