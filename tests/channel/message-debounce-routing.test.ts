import { describe, it, expect, afterEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatQueue = require("../../src/channel/chat-queue.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleMessageEvent } = require("../../src/channel/event-handlers.js");

const originalEnqueue = chatQueue.enqueueFeishuChatTask;
afterEach(() => {
  chatQueue.enqueueFeishuChatTask = originalEnqueue;
});

function textData(text = "hello") {
  return {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: `om_${Math.random().toString(36).slice(2)}`,
      message_type: "text",
      chat_id: "oc_1",
      chat_type: "group",
      create_time: String(Date.now()),
      content: JSON.stringify({ text }),
    },
  };
}

function makeLifecycle() {
  const calls = { registered: 0, abandoned: 0 };
  const abandonHandlers: Array<() => void> = [];
  return {
    calls,
    abandonHandlers,
    lifecycle: {
      abortSignal: new AbortController().signal,
      onAdopted: async () => {},
      onAbandoned: async () => {
        calls.abandoned++;
        for (const h of abandonHandlers) h();
      },
      onAdoptionFinalizing: () => {},
      registerAbandonHandler: (h: () => void) => {
        calls.registered++;
        abandonHandlers.push(h);
        return () => {};
      },
    },
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const enqueued: unknown[] = [];
  const released: unknown[] = [];
  return {
    accountId: "acct",
    lark: { account: {}, botOpenId: "ou_bot" },
    chatHistories: new Map(),
    messageDedup: {
      claim: async () => ({
        claimed: true,
        handle: { commit: async () => true, release: (o: unknown) => void released.push(o) },
      }),
      commit: async () => true,
      release: () => {},
      hasRecent: async () => false,
    },
    inboundDebouncer: {
      shouldBuffer: () => true,
      enqueue: async (e: unknown) => void enqueued.push(e),
      flushKey: async () => {},
      cancelKey: () => true,
      drain: async () => {},
    },
    resolveIngressLifecycle: () => makeLifecycle(),
    log: () => {},
    error: () => {},
    _enqueued: enqueued,
    _released: released,
    ...overrides,
  };
}

describe("handleMessageEvent — debounce routing (D4)", () => {
  it("returns {kind:'deferred'} and buffers when a lifecycle is present", async () => {
    const ctx = makeCtx();
    const result = await handleMessageEvent(ctx, textData());
    expect(result).toEqual({ kind: "deferred" });
    expect((ctx as { _enqueued: unknown[] })._enqueued).toHaveLength(1);
  });

  it("registers an abandon handler that releases the claim and drops the entry", async () => {
    const lc = makeLifecycle();
    const ctx = makeCtx({ resolveIngressLifecycle: () => lc.lifecycle });
    await handleMessageEvent(ctx, textData());
    expect(lc.calls.registered).toBe(1);
    const entry = (ctx as { _enqueued: Array<{ abandoned?: boolean }> })._enqueued[0];
    await lc.lifecycle.onAbandoned();
    expect(entry.abandoned).toBe(true);
    expect((ctx as { _released: unknown[] })._released.length).toBeGreaterThan(0);
  });

  it("buffers without deferring when there is no durable lifecycle", async () => {
    const ctx = makeCtx({ resolveIngressLifecycle: () => undefined });
    const result = await handleMessageEvent(ctx, textData());
    expect(result).toBeUndefined();
    expect((ctx as { _enqueued: unknown[] })._enqueued).toHaveLength(1);
  });

  it("takes the direct path (no buffer) when the message does not qualify", async () => {
    const calls: unknown[] = [];
    chatQueue.enqueueFeishuChatTask = (params: unknown) => {
      calls.push(params);
      return { status: "queued" };
    };
    const ctx = makeCtx({
      inboundDebouncer: {
        shouldBuffer: () => false,
        enqueue: async () => {
          throw new Error("should not buffer");
        },
        flushKey: async () => {},
        cancelKey: () => true,
        drain: async () => {},
      },
    });
    const result = await handleMessageEvent(ctx, textData());
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("drops self-authored messages without claiming", async () => {
    let claimed = false;
    const ctx = makeCtx({
      messageDedup: {
        claim: async () => {
          claimed = true;
          return { claimed: true, handle: { commit: async () => true, release: () => {} } };
        },
      },
    });
    const data = textData();
    (data.sender.sender_id as { open_id: string }).open_id = "ou_bot"; // self
    const result = await handleMessageEvent(ctx, data);
    expect(result).toBeUndefined();
    expect(claimed).toBe(false);
  });
});
