import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuPlugin } = require("../../src/channel/plugin.js");

const resolve = feishuPlugin.messaging.resolveDeliveryTarget;

describe("channel messaging.resolveDeliveryTarget", () => {
  it("routes a DM conversation to its user", () => {
    expect(resolve({ conversationId: "user:ou_a" })).toEqual({ to: "user:ou_a" });
    expect(resolve({ conversationId: "dm:ou_a" })).toEqual({ to: "user:ou_a" });
    expect(resolve({ conversationId: "ou_bare" })).toEqual({ to: "user:ou_bare" });
  });

  it("routes a plain chat conversation to the chat", () => {
    expect(resolve({ conversationId: "oc_chat" })).toEqual({ to: "chat:oc_chat" });
  });

  it("routes a topic conversation to the parent chat plus thread id", () => {
    expect(resolve({ conversationId: "oc_chat:topic:t1" })).toEqual({
      to: "chat:oc_chat",
      threadId: "t1",
    });
  });

  it("prefers an explicit parent for a bare topic id", () => {
    expect(resolve({ conversationId: "t9", parentConversationId: "oc_parent" })).toEqual({
      to: "chat:oc_parent",
      threadId: "t9",
    });
  });

  it("ignores sender scope when resolving a delivery target", () => {
    expect(resolve({ conversationId: "oc_chat:sender:ou_s" })).toEqual({ to: "chat:oc_chat" });
  });
});
