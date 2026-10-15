import { describe, it, expect } from "vitest";

// CJS source modules load directly under vitest (same pattern as actions-pin).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFeishuGroupSession } = require("../../src/messaging/inbound/bot-content.js");

const base = {
  chatId: "oc_group",
  senderOpenId: "ou_alice",
  messageId: "om_1",
};

const run = (overrides: Record<string, unknown> = {}) =>
  resolveFeishuGroupSession({ ...base, feishuCfg: {}, ...overrides });

describe("resolveFeishuGroupSession", () => {
  it("defaults to chat-scoped session (scope=group, no parent peer)", () => {
    const s = run();
    expect(s.peerId).toBe("oc_group");
    expect(s.groupSessionScope).toBe("group");
    expect(s.parentPeer).toBeNull();
    expect(s.replyInThread).toBe(false);
    expect(s.threadReply).toBe(false);
  });

  it("group_sender scopes the session per speaker", () => {
    const s = run({ feishuCfg: { groupSessionScope: "group_sender" } });
    expect(s.peerId).toBe("oc_group:sender:ou_alice");
    expect(s.parentPeer).toBeNull();
  });

  it("group_topic scopes by topic id and exposes the chat as parent peer", () => {
    const s = run({
      feishuCfg: { groupSessionScope: "group_topic" },
      rootId: "om_root",
    });
    expect(s.peerId).toBe("oc_group:topic:om_root");
    expect(s.parentPeer).toEqual({ kind: "group", id: "oc_group" });
  });

  it("group_topic_sender combines topic and sender", () => {
    const s = run({
      feishuCfg: { groupSessionScope: "group_topic_sender" },
      rootId: "om_root",
    });
    expect(s.peerId).toBe("oc_group:topic:om_root:sender:ou_alice");
    expect(s.parentPeer).toEqual({ kind: "group", id: "oc_group" });
  });

  it("group_topic falls back to the bare chat when there is no topic", () => {
    const s = run({ feishuCfg: { groupSessionScope: "group_topic" } });
    expect(s.peerId).toBe("oc_group");
    expect(s.parentPeer).toBeNull();
  });

  it("group_topic_sender degrades to group_sender when there is no topic", () => {
    const s = run({ feishuCfg: { groupSessionScope: "group_topic_sender" } });
    expect(s.peerId).toBe("oc_group:sender:ou_alice");
    expect(s.parentPeer).toBeNull();
  });

  it("uses the message id as the topic when replyInThread is enabled", () => {
    const s = run({
      feishuCfg: { groupSessionScope: "group_topic", replyInThread: "enabled" },
    });
    expect(s.replyInThread).toBe(true);
    expect(s.peerId).toBe("oc_group:topic:om_1");
    expect(s.parentPeer).toEqual({ kind: "group", id: "oc_group" });
  });

  it("accepts the legacy boolean replyInThread=true", () => {
    const s = run({ feishuCfg: { groupSessionScope: "group_topic", replyInThread: true } });
    expect(s.replyInThread).toBe(true);
    expect(s.peerId).toBe("oc_group:topic:om_1");
  });

  it("treats replyInThread=false/disabled as not enabled", () => {
    expect(run({ feishuCfg: { replyInThread: false } }).replyInThread).toBe(false);
    expect(run({ feishuCfg: { replyInThread: "disabled" } }).replyInThread).toBe(false);
  });

  it("treats a root/thread reply as threadReply (and therefore replyInThread)", () => {
    const s = run({ threadId: "omt_t1" });
    expect(s.threadReply).toBe(true);
    expect(s.replyInThread).toBe(true);
    expect(s.peerId).toBe("oc_group"); // default scope still chat-scoped
  });

  it("honours the legacy topicSessionMode=disabled/enabled alias", () => {
    expect(run({ feishuCfg: { topicSessionMode: "enabled" }, rootId: "om_root" }).peerId).toBe(
      "oc_group:topic:om_root",
    );
    expect(run({ feishuCfg: { topicSessionMode: "disabled" } }).peerId).toBe("oc_group");
  });

  it("per-group config overrides the account-level scope", () => {
    const s = run({
      groupConfig: { groupSessionScope: "group_sender" },
      feishuCfg: { groupSessionScope: "group_topic" },
      rootId: "om_root",
    });
    expect(s.groupSessionScope).toBe("group_sender");
    expect(s.peerId).toBe("oc_group:sender:ou_alice");
  });

  it("prefers threadId over rootId for a topic_group chat type", () => {
    const s = run({
      chatType: "topic_group",
      threadId: "omt_t1",
      rootId: "om_root",
      feishuCfg: { groupSessionScope: "group_topic" },
    });
    expect(s.peerId).toBe("oc_group:topic:omt_t1");
  });

  it("prefers rootId over threadId for a plain group chat type", () => {
    const s = run({
      chatType: "group",
      threadId: "omt_t1",
      rootId: "om_root",
      feishuCfg: { groupSessionScope: "group_topic" },
    });
    expect(s.peerId).toBe("oc_group:topic:om_root");
  });

  it("ignores blank/whitespace-only ids", () => {
    const s = run({ rootId: "   ", threadId: "" });
    expect(s.threadReply).toBe(false);
    expect(s.peerId).toBe("oc_group");
  });
});
