import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dispatch = require("../../src/messaging/inbound/dispatch.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const replyDispatcher = require("../../src/card/reply-dispatcher.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatQueue = require("../../src/channel/chat-queue.js");

/**
 * The abort fast-path in event-handlers.ts looks up the active dispatcher under
 * the monitor's enqueue key: `buildQueueKey(accountId, chatId, thread_id ||
 * root_id)`. Regression for batch B / B5: dispatch used to register under
 * `ctx.threadId` alone, so in topic groups whose reply events carry only
 * `root_id` the lookup missed and the fast abort path was dead.
 *
 * We pin the invariant by deriving the expected key from chatQueue.buildQueueKey
 * itself — the same expression the monitor uses.
 */

const ACCOUNT_SCOPED_CFG = {
  channels: { feishu: { appId: "cli_x", appSecret: "s" } },
};
const GLOBAL_CFG = { channels: { feishu: { appId: "cli_x" } } };

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "oc_1",
    messageId: "om_1",
    senderId: "ou_sender",
    chatType: "p2p",
    content: "hello",
    contentType: "text",
    resources: [],
    mentions: [],
    mentionAll: false,
    ...overrides,
  };
}

function makeAccount() {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    brand: "feishu",
    config: ACCOUNT_SCOPED_CFG.channels.feishu,
  };
}

/** Minimal stub of the OpenClaw plugin runtime surface used by dispatch. */
function makeCore() {
  return {
    config: { current: () => GLOBAL_CFG },
    channel: {
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: (opts: { body?: string }) => opts.body ?? "",
        finalizeInboundContext: (payload: unknown) => payload,
        dispatchReplyFromConfig: vi
          .fn()
          .mockResolvedValue({ queuedFinal: false, counts: { final: 1 } }),
        dispatchReplyWithBufferedBlockDispatcher: vi
          .fn()
          .mockResolvedValue(undefined),
      },
      routing: {
        resolveAgentRoute: () => ({
          agentId: "main",
          sessionKey: "agent:main:feishu:direct:oc_1",
        }),
      },
      commands: {
        isControlCommandMessage: () => false,
        shouldComputeCommandAuthorized: () => false,
        resolveCommandAuthorizedFromAuthorizers: () => false,
      },
    },
    system: { enqueueSystemEvent: () => undefined },
  };
}

function stubDispatcher() {
  vi.spyOn(replyDispatcher, "createFeishuReplyDispatcher").mockReturnValue({
    dispatcher: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
    replyOptions: {},
    markDispatchIdle: () => undefined,
    markFullyComplete: () => undefined,
    abortCard: () => undefined,
  });
  vi.spyOn(chatQueue, "unregisterActiveDispatcher").mockImplementation(
    () => undefined,
  );
}

async function dispatchWith(ctx: Record<string, unknown>) {
  LarkClient.setRuntime(makeCore());
  stubDispatcher();
  const registerSpy = vi
    .spyOn(chatQueue, "registerActiveDispatcher")
    .mockImplementation(() => undefined);

  await dispatch.dispatchToAgent({
    ctx: makeCtx(ctx),
    permissionError: undefined,
    mediaPayload: {},
    quotedContent: undefined,
    account: makeAccount(),
    accountScopedCfg: ACCOUNT_SCOPED_CFG,
    cfg: GLOBAL_CFG,
    chatHistories: undefined,
    historyLimit: 0,
    replyToMessageId: undefined,
    commandAuthorized: false,
    skipTyping: true,
  });

  expect(registerSpy).toHaveBeenCalledTimes(1);
  return registerSpy.mock.calls[0][0];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("dispatchToAgent — abort fast-path queue key (B5)", () => {
  it("registers under the monitor's thread_id||root_id key for a root_id-only reply", async () => {
    // Topic-group reply event: carries root_id, no thread_id.
    const key = await dispatchWith({ rootId: "om_root" });
    expect(key).toBe(chatQueue.buildQueueKey("default", "oc_1", "om_root"));
  });

  it("prefers thread_id over root_id when both are present", async () => {
    const key = await dispatchWith({ threadId: "omt_thread", rootId: "om_root" });
    expect(key).toBe(
      chatQueue.buildQueueKey("default", "oc_1", "omt_thread"),
    );
  });

  it("falls back to the bare chat key when neither id is present", async () => {
    const key = await dispatchWith({});
    expect(key).toBe(chatQueue.buildQueueKey("default", "oc_1", undefined));
  });
});
