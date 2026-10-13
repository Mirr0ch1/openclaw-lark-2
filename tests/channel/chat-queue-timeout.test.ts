import { describe, it, expect, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatQueue = require("../../src/channel/chat-queue.js");

/**
 * A hung dispatch must not block later messages in the same chat forever.
 * The per-task cap lets the queue chain advance while the stuck task keeps
 * running (ported from @openclaw/feishu, upstream #70133).
 */
describe("chat-queue — per-task timeout", () => {
  beforeEach(() => {
    chatQueue._resetChatQueueState();
  });

  it("evicts a stuck task so later same-key work proceeds", async () => {
    const order: string[] = [];
    const timeouts: Array<{ key: string; ms: number }> = [];
    let releaseStuck: (() => void) | undefined;
    const stuck = new Promise<void>((resolve) => {
      releaseStuck = resolve;
    });

    chatQueue.enqueueFeishuChatTask({
      accountId: "default",
      chatId: "oc_stuck",
      taskTimeoutMs: 20,
      onTaskTimeout: (key: string, ms: number) => timeouts.push({ key, ms }),
      task: async () => {
        order.push("first:start");
        await stuck;
        order.push("first:end");
      },
    });

    // Let the first task start and then blow past its 20ms cap.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0].ms).toBe(20);
    expect(timeouts[0].key).toContain("oc_stuck");

    // A second message for the same chat must not be blocked by the stuck one.
    const second = chatQueue.enqueueFeishuChatTask({
      accountId: "default",
      chatId: "oc_stuck",
      task: async () => {
        order.push("second");
      },
    });
    await second.promise;
    expect(order).toContain("second");

    // The stuck task is not cancelled — it finishes when finally released.
    releaseStuck?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toContain("first:end");
  });

  it("preserves strict FIFO when taskTimeoutMs is 0", async () => {
    const order: string[] = [];
    const first = chatQueue.enqueueFeishuChatTask({
      accountId: "default",
      chatId: "oc_fifo",
      taskTimeoutMs: 0,
      task: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("a");
      },
    });
    const second = chatQueue.enqueueFeishuChatTask({
      accountId: "default",
      chatId: "oc_fifo",
      taskTimeoutMs: 0,
      task: async () => {
        order.push("b");
      },
    });

    await Promise.all([first.promise, second.promise]);
    expect(order).toEqual(["a", "b"]);
  });
});
