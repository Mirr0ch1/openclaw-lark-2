import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Type } = require("@sinclair/typebox");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require("../../src/tools/helpers.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getFeishuToolCallParams,
  withFeishuToolCallParams,
} = require("../../src/core/tool-account.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createToolClient } = require("../../src/core/tool-client.js");

const CONFIG = {
  channels: {
    feishu: {
      appId: "cli_default",
      appSecret: "sec_default",
      accounts: {
        a1: { appId: "cli_a1", appSecret: "sec_a1" },
      },
    },
  },
};

function makeApi() {
  const registered: any[] = [];
  return {
    api: {
      config: CONFIG,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      registerTool: (tool: any) => {
        registered.push(tool);
      },
    },
    registered,
  };
}

describe("registerTool — accountId routing is reachable from the choke point", () => {
  it("augments the schema with an optional accountId", () => {
    const { api, registered } = makeApi();
    helpers.registerTool(api, {
      name: "feishu_fake",
      parameters: Type.Union([
        Type.Object({ action: Type.Literal("a"), x: Type.String() }),
        Type.Object({ action: Type.Literal("b"), y: Type.String() }),
      ]),
      execute: async () => helpers.formatToolResult({ ok: true }),
    });
    const tool = registered[0];
    for (const member of tool.parameters.anyOf) {
      expect(member.properties.accountId).toBeDefined();
    }
  });

  it("runs execute inside the param scope so client getters see accountId", async () => {
    const { api, registered } = makeApi();
    helpers.registerTool(api, {
      name: "feishu_fake",
      parameters: Type.Object({ action: Type.Literal("a") }),
      // A tool that resolves its account the classic way — no params threaded.
      execute: async (_id: string, _params: unknown) => ({
        seen: getFeishuToolCallParams(),
        accountId: helpers.getFirstAccount(CONFIG).accountId,
      }),
    });
    const tool = registered[0];
    const out = await tool.execute("call-1", { action: "a", accountId: "a1" });
    expect(out.seen).toEqual({ action: "a", accountId: "a1" });
    expect(out.accountId).toBe("a1");
  });

  it("does not leak the scope across sequential calls", async () => {
    const { api, registered } = makeApi();
    helpers.registerTool(api, {
      name: "feishu_fake",
      parameters: Type.Object({ action: Type.Literal("a") }),
      execute: async (_id: string, _params: unknown) => getFeishuToolCallParams(),
    });
    const tool = registered[0];
    await tool.execute("call-1", { action: "a", accountId: "a1" });
    const second = await tool.execute("call-2", { action: "a" });
    expect(second).toEqual({ action: "a" });
  });

  it("surfaces a clear error for an unknown explicit account", async () => {
    const { api, registered } = makeApi();
    helpers.registerTool(api, {
      name: "feishu_fake",
      parameters: Type.Object({ action: Type.Literal("a") }),
      execute: async () => helpers.getFirstAccount(CONFIG),
    });
    const tool = registered[0];
    await expect(tool.execute("call-1", { action: "a", accountId: "ghost" })).rejects.toThrow(
      /Unknown Feishu account/,
    );
  });

  it("routes an explicit accountId through createToolClient via the scope", async () => {
    const client = await withFeishuToolCallParams({ accountId: "a1" }, async () =>
      createToolClient(CONFIG),
    );
    expect(client.account.accountId).toBe("a1");
    expect(client.account.appId).toBe("cli_a1");
  });

  it("isolates concurrent tool calls with different accountIds", async () => {
    const [a1, fallback] = await Promise.all([
      withFeishuToolCallParams({ accountId: "a1" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return createToolClient(CONFIG).account.accountId;
      }),
      withFeishuToolCallParams({}, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return createToolClient(CONFIG).account.accountId;
      }),
    ]);
    expect(a1).toBe("a1");
    expect(fallback).toBe("default");
  });

  it("passes through tools without an execute unchanged", () => {
    const { api, registered } = makeApi();
    const passthrough = { name: "feishu_noop" };
    helpers.registerTool(api, passthrough);
    expect(registered[0]).toBe(passthrough);
  });
});
