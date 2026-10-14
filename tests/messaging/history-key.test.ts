import { describe, it, expect } from "vitest";

// CJS source modules load directly under vitest (same pattern as the other
// messaging tests).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildEnvelopeWithHistory } = require("../../src/messaging/inbound/dispatch-builders.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFeishuGroupSession } = require("../../src/messaging/inbound/bot-content.js");

// Minimal DispatchContext: we only assert on the returned `historyKey`, so a
// passthrough envelope formatter is enough and no SDK surface is touched.
function makeDc(overrides: Record<string, unknown> = {}) {
  return {
    isGroup: true,
    isThread: false,
    ctx: { chatId: "oc_group", threadId: undefined, rootId: undefined },
    envelopeFrom: "oc_group:ou_alice",
    envelopeOptions: {},
    groupSession: { peerId: "oc_group" },
    core: {
      channel: {
        reply: {
          formatAgentEnvelope: ({ body }: { body: string }) => body,
        },
      },
    },
    ...overrides,
  };
}

const keyFor = (dc: Record<string, unknown>) =>
  buildEnvelopeWithHistory(dc, "hello", undefined, 20).historyKey;

describe("group pending-history key (S1: writer/reader symmetry)", () => {
  // The regression: `resolveFeishuReplyRouting` infers a synthetic thread id
  // from `root_id` at dispatch time (threadSession + thread-capable group), so
  // the reader used to key on `peerId:thread:<rootId>` while the no-mention
  // WRITER buffered under the bare `peerId` — the pending context was silently
  // dropped. The key must be derivable purely from the raw context (official
  // `groupHistoryKey`, bot.ts:564).
  it("does NOT thread-suffix the key when a thread was inferred from root_id", () => {
    const dc = makeDc({
      isThread: true, // inference ran
      ctx: { chatId: "oc_group", threadId: "om_root", rootId: "om_root" },
      groupSession: { peerId: "oc_group" },
    });
    expect(keyFor(dc)).toBe("oc_group");
  });

  it("keys on the bare chat for the default group scope even with an explicit thread id", () => {
    const dc = makeDc({
      isThread: true,
      ctx: { chatId: "oc_group", threadId: "omt_t1", rootId: "om_root" },
    });
    expect(keyFor(dc)).toBe("oc_group");
  });

  it("equals the key the no-mention writer derives from the same raw context (group_topic)", () => {
    const raw = {
      chatId: "oc_group",
      senderOpenId: "ou_alice",
      messageId: "om_2",
      rootId: "om_root",
      chatType: "group",
      feishuCfg: { groupSessionScope: "group_topic" },
    };
    // What the writer (handler.ts) computes: resolveFeishuGroupSession(raw).peerId.
    const writerKey = resolveFeishuGroupSession(raw).peerId;
    expect(writerKey).toBe("oc_group:topic:om_root");
    // What the reader computes from the same raw context, after inference.
    const dc = makeDc({
      isThread: true,
      ctx: { chatId: "oc_group", threadId: "om_root", rootId: "om_root" },
      groupSession: resolveFeishuGroupSession(raw),
    });
    expect(keyFor(dc)).toBe(writerKey);
  });

  it("keeps per-topic isolation through the session scope (peerId encodes the topic)", () => {
    const dc = makeDc({ groupSession: { peerId: "oc_group:topic:om_root" } });
    expect(keyFor(dc)).toBe("oc_group:topic:om_root");
  });

  it("returns no key for DMs", () => {
    expect(keyFor(makeDc({ isGroup: false }))).toBeUndefined();
  });

  it("falls back to the bare chat id when there is no group session", () => {
    const dc = makeDc({ groupSession: undefined });
    expect(keyFor(dc)).toBe("oc_group");
  });
});
