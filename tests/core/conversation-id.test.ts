import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildFeishuConversationId,
  parseFeishuConversationId,
  parseFeishuDirectConversationId,
  parseFeishuTargetId,
  buildFeishuModelOverrideParentCandidates,
  resolveConfiguredFeishuGroupSessionScope,
} = require("../../src/core/conversation-id.js");

describe("buildFeishuConversationId / parseFeishuConversationId", () => {
  it("round-trips every scope", () => {
    const cases = [
      { chatId: "oc_x", scope: "group" },
      { chatId: "oc_x", scope: "group_topic", topicId: "t1" },
      { chatId: "oc_x", scope: "group_sender", senderOpenId: "ou_a" },
      { chatId: "oc_x", scope: "group_topic_sender", topicId: "t1", senderOpenId: "ou_a" },
    ] as const;
    for (const c of cases) {
      const id = buildFeishuConversationId(c);
      const back: any = parseFeishuConversationId({ conversationId: id });
      expect(back.scope).toBe(c.scope);
      expect(back.canonicalConversationId).toBe(id);
      expect(back.chatId).toBe("oc_x");
    }
  });

  it("ignores topic/sender parts that the scope does not include", () => {
    expect(buildFeishuConversationId({ chatId: "oc_x", scope: "group", topicId: "t1", senderOpenId: "ou_a" })).toBe("oc_x");
    expect(buildFeishuConversationId({ chatId: "oc_x", scope: "group_topic", topicId: "t1", senderOpenId: "ou_a" })).toBe("oc_x:topic:t1");
    expect(buildFeishuConversationId({ chatId: "oc_x", scope: "group_sender", topicId: "t1", senderOpenId: "ou_a" })).toBe("oc_x:sender:ou_a");
  });

  it("prefers the most specific scope when parsing", () => {
    // `:sender:` must not be swallowed into the topic id.
    const parsed: any = parseFeishuConversationId({ conversationId: "oc_x:topic:t1:sender:ou_a" });
    expect(parsed.scope).toBe("group_topic_sender");
    expect(parsed.topicId).toBe("t1");
    expect(parsed.senderOpenId).toBe("ou_a");
  });

  it("falls back to the parent conversation for a bare topic id", () => {
    const parsed: any = parseFeishuConversationId({ conversationId: "t9", parentConversationId: "oc_parent" });
    expect(parsed).toMatchObject({ scope: "group_topic", chatId: "oc_parent", topicId: "t9" });
    expect(parsed.canonicalConversationId).toBe("oc_parent:topic:t9");
  });

  it("treats an unknown id as a bare group conversation", () => {
    const parsed: any = parseFeishuConversationId({ conversationId: "oc_x" });
    expect(parsed).toMatchObject({ scope: "group", chatId: "oc_x" });
  });

  it("returns null for an empty conversation id", () => {
    expect(parseFeishuConversationId({ conversationId: "" })).toBeNull();
  });
});

describe("parseFeishuDirectConversationId", () => {
  it("extracts the open id from DM-shaped ids", () => {
    expect(parseFeishuDirectConversationId("user:ou_a")).toBe("ou_a");
    expect(parseFeishuDirectConversationId("dm:ou_a")).toBe("ou_a");
    expect(parseFeishuDirectConversationId("open_id:ou_a")).toBe("ou_a");
    expect(parseFeishuDirectConversationId("feishu:user:ou_a")).toBe("ou_a");
  });

  it("accepts a bare ou_ id but not a chat id", () => {
    expect(parseFeishuDirectConversationId("ou_bare")).toBe("ou_bare");
    expect(parseFeishuDirectConversationId("oc_chat")).toBeUndefined();
    expect(parseFeishuDirectConversationId("")).toBeUndefined();
  });

  it("strips both provider prefixes (feishu: and lark:)", () => {
    expect(parseFeishuDirectConversationId("feishu:ou_abc")).toBe("ou_abc");
    expect(parseFeishuDirectConversationId("lark:ou_abc")).toBe("ou_abc");
  });

  it("is safe on non-string / blank input", () => {
    for (const bad of [null, undefined, 42, {}, "   ", ""]) {
      expect(parseFeishuDirectConversationId(bad)).toBeUndefined();
      expect(parseFeishuTargetId(bad)).toBeUndefined();
      expect(parseFeishuConversationId({ conversationId: bad as any })).toBeNull();
    }
  });
});

describe("buildFeishuModelOverrideParentCandidates", () => {
  it("only applies to scoped (non-group) conversations", () => {
    expect(buildFeishuModelOverrideParentCandidates(undefined)).toEqual([]);
    expect(buildFeishuModelOverrideParentCandidates("oc_x")).toEqual([]);
    expect(buildFeishuModelOverrideParentCandidates("oc_x:topic:t1")).toEqual(["oc_x"]);
  });

  it("returns topic-then-chat for topic+sender scope", () => {
    expect(buildFeishuModelOverrideParentCandidates("oc_x:topic:t1:sender:ou_a")).toEqual([
      "oc_x:topic:t1",
      "oc_x",
    ]);
  });
});

describe("resolveConfiguredFeishuGroupSessionScope", () => {
  it("defaults to per-chat", () => {
    expect(resolveConfiguredFeishuGroupSessionScope({})).toBe("group");
  });

  it("honours the legacy topicSessionMode flag", () => {
    expect(resolveConfiguredFeishuGroupSessionScope({ feishuCfg: { topicSessionMode: "enabled" } })).toBe("group_topic");
    expect(resolveConfiguredFeishuGroupSessionScope({ feishuCfg: { topicSessionMode: "disabled" } })).toBe("group");
  });

  it("lets an explicit scope win over the legacy flag", () => {
    expect(
      resolveConfiguredFeishuGroupSessionScope({
        feishuCfg: { groupSessionScope: "group_sender", topicSessionMode: "enabled" },
      }),
    ).toBe("group_sender");
    expect(
      resolveConfiguredFeishuGroupSessionScope({
        groupConfig: { groupSessionScope: "group_topic_sender" },
        feishuCfg: { groupSessionScope: "group_sender" },
      }),
    ).toBe("group_topic_sender");
  });
});
