import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dispatchContext = require("../../src/messaging/inbound/dispatch-context.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dispatch = require("../../src/messaging/inbound/dispatch.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const replyDispatcher = require("../../src/card/reply-dispatcher.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatQueue = require("../../src/channel/chat-queue.js");

/**
 * Core dispatch must receive the *global* config, not the account-scoped copy:
 * OpenClaw 2.0 hashes the whole config when handing out the prepared model
 * catalog, and a mutated copy trips PreparedModelCatalogConfigReplacedError.
 * See docs in src/messaging/inbound/dispatch-context.js.
 */

const ACCOUNT_SCOPED_CFG = {
  channels: { feishu: { appId: "cli_scoped", appSecret: "scoped" } },
};
const GLOBAL_CFG = {
  channels: { feishu: { appId: "cli_top", accounts: { plaud: { appId: "cli_plaud" } } } },
};

function makeCtx(overrides = {}) {
  return {
    chatId: "ou_sender",
    messageId: "om_1",
    senderId: "ou_sender",
    senderName: "tester",
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
function makeCore(liveCfg?: unknown) {
  return {
    config: liveCfg === undefined ? undefined : { current: () => liveCfg },
    channel: {
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: (opts: { body?: string }) => opts.body ?? "",
        finalizeInboundContext: (payload: unknown) => payload,
        dispatchReplyFromConfig: vi
          .fn()
          .mockResolvedValue({ queuedFinal: false, counts: { final: 1 } }),
        dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockResolvedValue(undefined),
      },
      routing: {
        resolveAgentRoute: () => ({
          agentId: "main",
          sessionKey: "agent:main:feishu:direct:ou_sender",
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

function build(params: Record<string, unknown>) {
  return dispatchContext.buildDispatchContext({
    ctx: makeCtx(),
    account: makeAccount(),
    accountScopedCfg: ACCOUNT_SCOPED_CFG,
    ...params,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("buildDispatchContext — globalConfig resolution", () => {
  it("uses the caller-supplied cfg as globalConfig", () => {
    LarkClient.setRuntime(makeCore({}));
    const dc = build({ cfg: GLOBAL_CFG });
    expect(dc.globalConfig).toBe(GLOBAL_CFG);
    // The account-scoped copy stays intact for channel-internal policy.
    expect(dc.accountScopedCfg).toBe(ACCOUNT_SCOPED_CFG);
  });

  it("falls back to the live runtime config when cfg is omitted", () => {
    LarkClient.setRuntime(makeCore(GLOBAL_CFG));
    const dc = build({});
    expect(dc.globalConfig).toBe(GLOBAL_CFG);
  });

  it("ignores an empty live config and keeps accountScopedCfg", () => {
    // config.current() returns {} while the runtime config snapshot is cleared.
    // `??` cannot catch this, so buildDispatchContext must filter it explicitly —
    // dispatching with cfg:{} would drop agents, models and session config.
    LarkClient.setRuntime(makeCore({}));
    const dc = build({});
    expect(dc.globalConfig).toBe(ACCOUNT_SCOPED_CFG);
  });

  it("keeps accountScopedCfg when the runtime exposes no config accessor", () => {
    LarkClient.setRuntime(makeCore(undefined));
    const dc = build({});
    expect(dc.globalConfig).toBe(ACCOUNT_SCOPED_CFG);
  });
});

describe("dispatchToAgent — core dispatch receives globalConfig", () => {
  function stubDispatcher() {
    vi.spyOn(replyDispatcher, "createFeishuReplyDispatcher").mockReturnValue({
      dispatcher: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
      replyOptions: {},
      markDispatchIdle: () => undefined,
      markFullyComplete: () => undefined,
      abortCard: () => undefined,
    });
    vi.spyOn(chatQueue, "registerActiveDispatcher").mockImplementation(() => undefined);
    vi.spyOn(chatQueue, "unregisterActiveDispatcher").mockImplementation(() => undefined);
  }

  it("passes globalConfig and usePublishedModelRuntime to dispatchReplyFromConfig", async () => {
    const core = makeCore(GLOBAL_CFG);
    LarkClient.setRuntime(core);
    stubDispatcher();

    await dispatch.dispatchToAgent({
      ctx: makeCtx(),
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

    expect(core.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
    const call = core.channel.reply.dispatchReplyFromConfig.mock.calls[0][0];
    expect(call.cfg).toBe(GLOBAL_CFG);
    expect(call.cfg).not.toBe(ACCOUNT_SCOPED_CFG);
    expect(call.usePublishedModelRuntime).toBe(true);
  });

  it("does not dispatch with an empty cfg when the runtime config snapshot is cleared", async () => {
    const core = makeCore({});
    LarkClient.setRuntime(core);
    stubDispatcher();

    await dispatch.dispatchToAgent({
      ctx: makeCtx(),
      permissionError: undefined,
      mediaPayload: {},
      quotedContent: undefined,
      account: makeAccount(),
      accountScopedCfg: ACCOUNT_SCOPED_CFG,
      chatHistories: undefined,
      historyLimit: 0,
      replyToMessageId: undefined,
      commandAuthorized: false,
      skipTyping: true,
    });

    const call = core.channel.reply.dispatchReplyFromConfig.mock.calls[0][0];
    expect(call.cfg).toBe(ACCOUNT_SCOPED_CFG);
  });
});
