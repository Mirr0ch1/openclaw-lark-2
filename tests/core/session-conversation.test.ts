import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveFeishuSessionConversation,
  resolveFeishuParentConversationCandidates,
} = require("../../src/core/session-conversation.js");

describe("resolveFeishuSessionConversation", () => {
  it("returns the canonical id and base conversation", () => {
    expect(resolveFeishuSessionConversation({ kind: "group", rawId: "oc_x" })).toEqual({
      id: "oc_x",
      baseConversationId: "oc_x",
      parentConversationCandidates: [],
    });
  });

  it("keeps the topic inside the id and offers the chat as parent", () => {
    expect(resolveFeishuSessionConversation({ kind: "group", rawId: "oc_x:topic:t1" })).toEqual({
      id: "oc_x:topic:t1",
      baseConversationId: "oc_x",
      parentConversationCandidates: ["oc_x"],
    });
  });

  it("offers topic-then-chat parents for topic+sender scope", () => {
    expect(
      resolveFeishuSessionConversation({ kind: "group", rawId: "oc_x:topic:t1:sender:ou_a" }),
    ).toEqual({
      id: "oc_x:topic:t1:sender:ou_a",
      baseConversationId: "oc_x",
      parentConversationCandidates: ["oc_x:topic:t1", "oc_x"],
    });
  });

  it("ignores kind (channel behaves like group)", () => {
    expect(resolveFeishuSessionConversation({ kind: "channel", rawId: "oc_x:topic:t1" })).toEqual({
      id: "oc_x:topic:t1",
      baseConversationId: "oc_x",
      parentConversationCandidates: ["oc_x"],
    });
  });

  it("returns null for a blank id", () => {
    expect(resolveFeishuSessionConversation({ kind: "group", rawId: "   " })).toBeNull();
  });

  it("always includes the parentConversationCandidates key (so core treats them as explicit)", () => {
    const resolved = resolveFeishuSessionConversation({ kind: "group", rawId: "oc_x" });
    expect(Object.hasOwn(resolved, "parentConversationCandidates")).toBe(true);
  });
});

describe("resolveFeishuParentConversationCandidates", () => {
  it("is empty for a bare chat or an unknown id", () => {
    expect(resolveFeishuParentConversationCandidates("oc_x")).toEqual([]);
    expect(resolveFeishuParentConversationCandidates("")).toEqual([]);
  });

  it("maps each scope to its fallback chain", () => {
    expect(resolveFeishuParentConversationCandidates("oc_x:topic:t1")).toEqual(["oc_x"]);
    expect(resolveFeishuParentConversationCandidates("oc_x:sender:ou_a")).toEqual(["oc_x"]);
    expect(resolveFeishuParentConversationCandidates("oc_x:topic:t1:sender:ou_a")).toEqual([
      "oc_x:topic:t1",
      "oc_x",
    ]);
  });
});
