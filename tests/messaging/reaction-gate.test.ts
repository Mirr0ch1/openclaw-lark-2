import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const accounts = require("../../src/core/accounts.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const userNameCache = require("../../src/messaging/inbound/user-name-cache.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require("../../src/messaging/inbound/gate.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dispatch = require("../../src/messaging/inbound/dispatch.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reactionHandler = require("../../src/messaging/inbound/reaction-handler.js");

/**
 * Reaction events bypass the 7-stage message pipeline and call dispatchToAgent
 * directly, so they MUST run the same admission gate as normal messages.
 * Regression for batch B / B1: a member rejected by dmPolicy/groupPolicy/
 * allowlist must not be able to trigger the agent just by reacting.
 */

const CFG = { channels: { feishu: { appId: "cli_x", appSecret: "s" } } };

function makeAccount() {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    brand: "feishu",
    appId: "cli_x",
    config: { reactionNotifications: "own" },
  };
}

function makeEvent() {
  return {
    reaction_type: { emoji_type: "THUMBSUP" },
    message_id: "om_1",
    user_id: { open_id: "ou_op" },
    action_time: "1700000000000",
  };
}

function makePreResolved() {
  return {
    chatId: "ou_op",
    chatType: "p2p",
    threadId: undefined,
    threadCapable: false,
    msg: { content: "hello", threadId: undefined },
  };
}

function call(overrides: Record<string, unknown> = {}) {
  return reactionHandler.handleFeishuReaction({
    cfg: CFG,
    event: makeEvent(),
    runtime: undefined,
    chatHistories: undefined,
    accountId: "default",
    preResolved: makePreResolved(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(accounts, "getLarkAccount").mockReturnValue(makeAccount());
  vi.spyOn(userNameCache, "resolveUserName").mockResolvedValue({ name: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("handleFeishuReaction — access gate enforcement (B1)", () => {
  it("does NOT dispatch when the access gate rejects the sender/chat", async () => {
    vi.spyOn(gate, "checkMessageGate").mockResolvedValue({
      allowed: false,
      reason: "dmPolicy",
    });
    const dispatchSpy = vi
      .spyOn(dispatch, "dispatchToAgent")
      .mockResolvedValue(undefined);

    await call();

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("dispatches when the gate allows, treating the mention requirement as satisfied", async () => {
    const gateSpy = vi
      .spyOn(gate, "checkMessageGate")
      .mockResolvedValue({ allowed: true });
    const dispatchSpy = vi
      .spyOn(dispatch, "dispatchToAgent")
      .mockResolvedValue(undefined);

    await call();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    // A reaction is an implicit interaction: group mention requirement is
    // satisfied, but policy/allowlist checks still run.
    expect(gateSpy.mock.calls[0][0].mentionSatisfied).toBe(true);
  });
});
