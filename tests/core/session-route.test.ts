import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFeishuOutboundSessionRoute } = require("../../src/core/session-route.js");

const baseCfg = (feishu: Record<string, unknown> = {}) => ({
  channels: { feishu: { appId: "cli_x", appSecret: "sec_x", ...feishu } },
});

const run = (target: string, feishu?: Record<string, unknown>, accountId = "default") =>
  resolveFeishuOutboundSessionRoute({ cfg: baseCfg(feishu), agentId: "main", accountId, target });

describe("resolveFeishuOutboundSessionRoute", () => {
  it("routes a chat id as a group", () => {
    const route = run("feishu:oc_chat");
    expect(route).toMatchObject({
      peer: { kind: "group", id: "oc_chat" },
      chatType: "group",
      from: "feishu:group:oc_chat",
      to: "oc_chat",
      recipientSessionExact: true,
    });
  });

  it("routes an open id as a direct chat", () => {
    const route = run("feishu:ou_user");
    expect(route).toMatchObject({
      peer: { kind: "direct", id: "ou_user" },
      chatType: "direct",
      from: "feishu:ou_user",
      to: "ou_user",
      recipientSessionExact: true,
    });
  });

  it("is tag-aware: chat:/group:/channel: prefixes count as groups", () => {
    for (const tag of ["chat:", "group:", "channel:"]) {
      const route = run(`${tag}oc_chat`);
      expect(route?.peer).toEqual({ kind: "group", id: "oc_chat" });
      expect(route?.chatType).toBe("group");
    }
  });

  it("strips the lark: provider prefix too", () => {
    expect(run("lark:oc_chat")?.peer).toEqual({ kind: "group", id: "oc_chat" });
    expect(run("lark:ou_user")?.peer).toEqual({ kind: "direct", id: "ou_user" });
  });

  it("marks a group as non-exact when the group is sender/topic scoped", () => {
    // Default scope is per-chat -> exact.
    expect(run("feishu:oc_chat")?.recipientSessionExact).toBe(true);
    // Account-level sender scope -> the bare chat id no longer identifies the session.
    expect(run("feishu:oc_chat", { groupSessionScope: "group_sender" })?.recipientSessionExact).toBe(false);
    expect(run("feishu:oc_chat", { groupSessionScope: "group_topic" })?.recipientSessionExact).toBe(false);
  });

  it("honours a per-group scope override over the account default", () => {
    const feishu = {
      groupSessionScope: "group",
      groups: { oc_scoped: { groupSessionScope: "group_sender" } },
    };
    expect(run("feishu:oc_plain", feishu)?.recipientSessionExact).toBe(true);
    expect(run("feishu:oc_scoped", feishu)?.recipientSessionExact).toBe(false);
  });

  it("honours the legacy topicSessionMode flag", () => {
    expect(run("feishu:oc_chat", { topicSessionMode: "enabled" })?.recipientSessionExact).toBe(false);
    expect(run("feishu:oc_chat", { topicSessionMode: "disabled" })?.recipientSessionExact).toBe(true);
  });

  it("honours a groups[\"*\"] default scope", () => {
    const feishu = { groups: { "*": { groupSessionScope: "group_topic" } } };
    expect(run("feishu:oc_any", feishu)?.recipientSessionExact).toBe(false);
  });

  it("lets an explicit group entry win over groups[\"*\"]", () => {
    const feishu = {
      groups: {
        "*": { groupSessionScope: "group_topic" },
        oc_special: { groupSessionScope: "group" },
      },
    };
    expect(run("feishu:oc_special", feishu)?.recipientSessionExact).toBe(true);
    expect(run("feishu:oc_other", feishu)?.recipientSessionExact).toBe(false);
  });

  it("is feature-detected and reports support on this core", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sr = require("../../src/core/session-route.js");
    expect(sr.isFeishuOutboundSessionRouteSupported()).toBe(true);
  });

  it("returns null for an empty target", () => {
    expect(run("feishu:")).toBeNull();
    expect(run("")).toBeNull();
  });
});
