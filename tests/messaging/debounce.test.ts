import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  extractDebounceText,
  mergeFeishuDebounceMentions,
  isMentionForwardRequest,
  resolveFeishuDebounceMentions,
  dedupeFeishuDebounceEntriesByDedupeKey,
  createFeishuInboundDebouncer,
} = require("../../src/messaging/inbound/debounce.js");

let seq = 0;
function textEvent(text: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: `om_${seq}`,
      message_type: "text",
      chat_id: "oc_1",
      chat_type: "group",
      create_time: String(1700000000000 + seq),
      content: JSON.stringify({ text }),
      ...overrides,
    },
  };
}
function makeClaim() {
  const calls = { commit: 0, release: 0 };
  return {
    calls,
    claim: {
      commit: async () => {
        calls.commit++;
        return true;
      },
      release: () => {
        calls.release++;
      },
    },
  };
}

describe("extractDebounceText", () => {
  it("substitutes mention placeholders with @Name", () => {
    const ev = textEvent("hi @_user_1 bye", {
      mentions: [{ key: "@_user_1", name: "Alice", id: { open_id: "ou_a" } }],
    });
    expect(extractDebounceText(ev)).toBe("hi @Alice bye");
  });

  it("strips leftover placeholders and trims", () => {
    expect(extractDebounceText(textEvent("  @_user_9  hello  "))).toBe("hello");
  });

  it("removes the bot's own mention but keeps other mentions", () => {
    const ev = textEvent("@_user_1 /reset", {
      mentions: [{ key: "@_user_1", name: "MyBot", id: { open_id: "ou_bot" } }],
    });
    expect(extractDebounceText(ev, "ou_bot")).toBe("/reset");
    expect(extractDebounceText(ev, "ou_other")).toBe("@MyBot /reset");
  });

  it("returns empty string for non-text or unparseable messages", () => {
    expect(extractDebounceText(textEvent("x", { message_type: "image" }))).toBe("");
    expect(extractDebounceText(textEvent("x", { content: "{not json" }))).toBe("");
    expect(extractDebounceText(undefined)).toBe("");
  });
});

describe("mergeFeishuDebounceMentions / resolveFeishuDebounceMentions", () => {
  const m = (openId: string, name: string, key: string) => ({ key, name, id: { open_id: openId } });

  it("unions mentions across events, de-duplicated by open_id", () => {
    const a = textEvent("a", { mentions: [m("ou_a", "Alice", "@_user_1")] });
    const b = textEvent("b", { mentions: [m("ou_a", "Alice", "@_user_1"), m("ou_b", "Bob", "@_user_2")] });
    const merged = mergeFeishuDebounceMentions([a, b]);
    expect(merged).toHaveLength(2);
  });

  it("returns undefined when there are no mentions", () => {
    expect(mergeFeishuDebounceMentions([textEvent("a")])).toBeUndefined();
  });

  it("keeps only the bot's mentions for a normal group merge", () => {
    const a = textEvent("a", { mentions: [m("ou_bot", "Bot", "@_user_1")] });
    const b = textEvent("b", { mentions: [m("ou_other", "Other", "@_user_2")] });
    const resolved = resolveFeishuDebounceMentions({ entries: [a, b], botOpenId: "ou_bot" });
    expect(resolved).toHaveLength(1);
    expect((resolved as Array<{ id: { open_id: string } }>)[0].id.open_id).toBe("ou_bot");
  });

  it("uses the forwarding entry's mentions when it is a mention-forward request", () => {
    // Group: bot + another user mentioned → forward request.
    const forward = textEvent("fwd", {
      mentions: [m("ou_bot", "Bot", "@_user_1"), m("ou_target", "Target", "@_user_2")],
    });
    const resolved = resolveFeishuDebounceMentions({ entries: [forward], botOpenId: "ou_bot" });
    expect(resolved).toHaveLength(2);
  });

  it("isMentionForwardRequest: DM needs any user; group needs bot + other", () => {
    const dm = textEvent("x", { chat_type: "p2p", mentions: [m("ou_a", "A", "@_user_1")] });
    expect(isMentionForwardRequest(dm, "ou_bot")).toBe(true);
    const groupOnlyBot = textEvent("x", { chat_type: "group", mentions: [m("ou_bot", "Bot", "@_user_1")] });
    expect(isMentionForwardRequest(groupOnlyBot, "ou_bot")).toBe(false);
    const groupBoth = textEvent("x", {
      chat_type: "group",
      mentions: [m("ou_bot", "Bot", "@_user_1"), m("ou_a", "A", "@_user_2")],
    });
    expect(isMentionForwardRequest(groupBoth, "ou_bot")).toBe(true);
  });
});

describe("dedupeFeishuDebounceEntriesByDedupeKey", () => {
  it("keeps the first entry per logical dedupe key", () => {
    const e1 = { event: textEvent("same") };
    // Same sender/chat/content/create_time → same logical key.
    const e2 = { event: { ...e1.event } };
    const e3 = { event: textEvent("different") };
    const out = dedupeFeishuDebounceEntriesByDedupeKey([e1, e2, e3]);
    expect(out).toHaveLength(2);
  });
});

describe("createFeishuInboundDebouncer", () => {
  function build(debounceMs: number, opts: { isControlCommand?: (t: string) => boolean } = {}) {
    const dispatched: Array<Record<string, unknown>> = [];
    const debouncer = createFeishuInboundDebouncer({
      accountId: "acct",
      debounceMs,
      dispatch: async (event: Record<string, unknown>) => {
        dispatched.push(event);
      },
      hasProcessed: async () => false,
      isControlCommand: opts.isControlCommand,
      log: () => {},
      error: () => {},
    });
    return { debouncer, dispatched };
  }

  it("merges rapid text messages into one dispatch", async () => {
    const { debouncer, dispatched } = build(20);
    const a = makeClaim();
    const b = makeClaim();
    await debouncer.enqueue({ event: textEvent("hello"), processingClaim: a.claim });
    await debouncer.enqueue({ event: textEvent("world"), processingClaim: b.claim });
    await debouncer.drain();
    expect(dispatched).toHaveLength(1);
    const content = JSON.parse((dispatched[0] as { message: { content: string } }).message.content);
    expect(content.text).toBe("hello\nworld");
  });

  it("dispatches a lone message unchanged", async () => {
    const { debouncer, dispatched } = build(20);
    const a = makeClaim();
    await debouncer.enqueue({ event: textEvent("solo"), processingClaim: a.claim });
    await debouncer.drain();
    expect(dispatched).toHaveLength(1);
    const content = JSON.parse((dispatched[0] as { message: { content: string } }).message.content);
    expect(content.text).toBe("solo");
  });

  it("does not buffer non-text messages", async () => {
    const { debouncer } = build(20);
    const img = textEvent("x", { message_type: "image" });
    expect(debouncer.shouldBuffer({ event: img })).toBe(false);
  });

  it("does not buffer control commands", async () => {
    const { debouncer } = build(20, { isControlCommand: (t: string) => t.startsWith("/") });
    expect(debouncer.shouldBuffer({ event: textEvent("/reset") })).toBe(false);
    expect(debouncer.shouldBuffer({ event: textEvent("hello") })).toBe(true);
  });

  it("does not buffer when debounceMs is 0 (feature off)", async () => {
    const { debouncer } = build(0);
    expect(debouncer.shouldBuffer({ event: textEvent("hello") })).toBe(false);
  });

  it("keys by account + chat + sender, isolating different senders", async () => {
    const { debouncer } = build(20);
    const a = textEvent("a");
    const b = textEvent("b");
    (b.sender.sender_id as { open_id: string }).open_id = "ou_other";
    const ka = debouncer.shouldBuffer({ event: a });
    const kb = debouncer.shouldBuffer({ event: b });
    expect(ka).toBe(true);
    expect(kb).toBe(true);
  });

  it("commits the dispatched claim and the suppressed claims (no lifecycle)", async () => {
    const a = makeClaim();
    const b = makeClaim();
    const c = makeClaim();
    const debouncer = createFeishuInboundDebouncer({
      accountId: "acct",
      debounceMs: 20,
      dispatch: async (_event: unknown, _key: unknown, claim: { commit: () => Promise<boolean> }) => {
        await claim?.commit?.();
      },
      hasProcessed: async () => false,
      log: () => {},
      error: () => {},
    });
    await debouncer.enqueue({ event: textEvent("a"), processingClaim: a.claim });
    await debouncer.enqueue({ event: textEvent("b"), processingClaim: b.claim });
    await debouncer.enqueue({ event: textEvent("c"), processingClaim: c.claim });
    await debouncer.drain();
    expect(a.calls.commit + b.calls.commit + c.calls.commit).toBe(3);
    expect(a.calls.release + b.calls.release + c.calls.release).toBe(0);
  });

  it("drops already-processed entries from the merge", async () => {
    const dispatched: Array<Record<string, unknown>> = [];
    const debouncer = createFeishuInboundDebouncer({
      accountId: "acct",
      debounceMs: 20,
      dispatch: async (event: Record<string, unknown>) => {
        dispatched.push(event);
      },
      // Every entry reports as already processed except none → no fresh entry.
      hasProcessed: async () => true,
      log: () => {},
      error: () => {},
    });
    await debouncer.enqueue({ event: textEvent("a"), processingClaim: makeClaim().claim });
    await debouncer.enqueue({ event: textEvent("b"), processingClaim: makeClaim().claim });
    await debouncer.drain();
    expect(dispatched).toHaveLength(0);
  });

  it("commits every buffered claim when all entries are already processed (no leak)", async () => {
    const a = makeClaim();
    const b = makeClaim();
    const debouncer = createFeishuInboundDebouncer({
      accountId: "acct",
      debounceMs: 20,
      dispatch: async () => {
        throw new Error("should not dispatch");
      },
      hasProcessed: async () => true,
      log: () => {},
      error: () => {},
    });
    await debouncer.enqueue({ event: textEvent("a"), processingClaim: a.claim });
    await debouncer.enqueue({ event: textEvent("b"), processingClaim: b.claim });
    await debouncer.drain();
    expect(a.calls.commit + b.calls.commit).toBe(2);
  });

  it("with a durable lifecycle, adopts and commits the replay claim (commit-after-adoption)", async () => {
    const adopted = { count: 0 };
    const committed = { count: 0 };
    const lifecycle = {
      abortSignal: new AbortController().signal,
      onAdopted: async () => {
        adopted.count++;
      },
      onDeferred: () => {},
      onAdoptionFinalizing: () => {},
      onAbandoned: async () => {},
    };
    const claim = {
      commit: async () => {
        committed.count++;
        return true;
      },
      release: () => {},
    };
    const debouncer = createFeishuInboundDebouncer({
      accountId: "acct",
      debounceMs: 20,
      // Emulate dispatchFeishuMessage: adopt (the fan-in commits after adoption).
      dispatch: async (_event: unknown, _key: unknown, _claim: unknown, admissionLifecycle: { onAdopted: () => Promise<void> }) => {
        await admissionLifecycle.onAdopted();
      },
      hasProcessed: async () => false,
      log: () => {},
      error: () => {},
    });
    await debouncer.enqueue({ event: textEvent("solo"), processingClaim: claim, turnAdoptionLifecycle: lifecycle });
    await debouncer.drain();
    expect(adopted.count).toBe(1);
    expect(committed.count).toBe(1);
  });
});
