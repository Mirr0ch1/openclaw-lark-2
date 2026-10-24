import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FeishuConfigSchema } = require("../../src/core/config-schema.js");

describe("tools flags / larkCli survive schema validation", () => {
  it("preserves tools.mail / sheets / okr (previously stripped)", () => {
    const out = FeishuConfigSchema.parse({
      tools: { doc: true, sheets: false, mail: false, okr: true },
    });
    expect(out.tools.sheets).toBe(false);
    expect(out.tools.mail).toBe(false);
    expect(out.tools.okr).toBe(true);
  });

  it("drops the retired MCP endpoint override", () => {
    // The MCP doc-tool transport (and mcpEndpoint / mcp_url) was removed with
    // feishu_create_doc/fetch_doc/update_doc; lark-cli 'docs' replaced it.
    const out: Record<string, unknown> = FeishuConfigSchema.parse({
      mcpEndpoint: "https://x/mcp",
      mcp_url: "https://legacy/mcp",
    });
    expect(out.mcpEndpoint).toBeUndefined();
    expect(out.mcp_url).toBeUndefined();
  });

  it("preserves the larkCli block (prompt mode included)", () => {
    const out = FeishuConfigSchema.parse({ larkCli: { enabled: "auto", prompt: "compact" } });
    expect(out.larkCli.enabled).toBe("auto");
    expect(out.larkCli.prompt).toBe("compact");
  });
});

describe("group session scope config keys", () => {
  it("accepts groupSessionScope / topicSessionMode at the top level", () => {
    const out = FeishuConfigSchema.parse({ groupSessionScope: "group_topic", topicSessionMode: "enabled" });
    expect(out.groupSessionScope).toBe("group_topic");
    expect(out.topicSessionMode).toBe("enabled");
  });

  it("accepts them per group (including the '*' default entry)", () => {
    const out = FeishuConfigSchema.parse({
      groups: {
        "*": { groupSessionScope: "group_topic" },
        oc_x: { groupSessionScope: "group_sender" },
      },
    });
    expect(out.groups["*"].groupSessionScope).toBe("group_topic");
    expect(out.groups.oc_x.groupSessionScope).toBe("group_sender");
  });

  it("accepts them per account", () => {
    const out = FeishuConfigSchema.parse({
      accounts: { plaud: { appId: "a", appSecret: "b", groupSessionScope: "group_topic_sender" } },
    });
    expect(out.accounts.plaud.groupSessionScope).toBe("group_topic_sender");
  });

  it("rejects an unknown scope value", () => {
    expect(() => FeishuConfigSchema.parse({ groupSessionScope: "bogus" })).toThrow();
    expect(() => FeishuConfigSchema.parse({ topicSessionMode: "maybe" })).toThrow();
  });
});
