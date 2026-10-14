import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FeishuConfigSchema } = require("../../src/core/config-schema.js");

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
