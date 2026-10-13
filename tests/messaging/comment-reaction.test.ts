import { describe, it, expect, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cr = require("../../src/messaging/inbound/comment-reaction.js");

const CFG = { channels: { feishu: { appId: "cli_x", appSecret: "sec_x" } } };
const originalFromCfg = LarkClient.fromCfg;

function installClient(opts: { configured?: boolean; typingIndicator?: boolean; code?: number } = {}) {
  const calls: any[] = [];
  LarkClient.fromCfg = () => ({
    account: {
      accountId: "default",
      configured: opts.configured ?? true,
      config: { typingIndicator: opts.typingIndicator ?? true },
    },
    sdk: {
      request: async (req: any) => {
        calls.push(req);
        return { code: opts.code ?? 0, msg: "ok" };
      },
    },
  });
  return calls;
}

describe("comment typing reaction lifecycle", () => {
  beforeEach(() => cr._resetCommentTypingReactionState());
  afterEach(() => {
    LarkClient.fromCfg = originalFromCfg;
    cr._resetCommentTypingReactionState();
  });

  it("adds on start and deletes on cleanup", async () => {
    const calls = installClient();
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc1",
      fileType: "docx",
      replyId: "rep1",
    });
    await lifecycle.start();
    await lifecycle.cleanup();
    expect(calls.map((c) => c.data.action)).toEqual(["add", "delete"]);
    expect(calls[0].data.reaction_type).toBe("Typing");
    expect(calls[0].url).toContain("/open-apis/drive/v2/files/doc1/comments/reaction");
    expect(calls[0].url).toContain("file_type=docx");
  });

  it("is a no-op when the event is not a reply", async () => {
    const calls = installClient();
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc1",
      fileType: "docx",
    });
    await lifecycle.start();
    await lifecycle.cleanup();
    expect(calls).toHaveLength(0);
  });

  it("does nothing when typingIndicator is disabled", async () => {
    const calls = installClient({ typingIndicator: false });
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc1",
      fileType: "docx",
      replyId: "rep1",
    });
    await lifecycle.start();
    await lifecycle.cleanup();
    expect(calls).toHaveLength(0);
  });

  it("never deletes a reaction that failed to add", async () => {
    const calls = installClient({ code: 99991663 });
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc1",
      fileType: "docx",
      replyId: "rep1",
    });
    await lifecycle.start();
    await lifecycle.cleanup();
    expect(calls.map((c) => c.data.action)).toEqual(["add"]);
  });

  it("does not delete twice", async () => {
    const calls = installClient();
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc1",
      fileType: "docx",
      replyId: "rep1",
    });
    await lifecycle.start();
    await lifecycle.cleanup();
    await lifecycle.cleanup();
    expect(calls.filter((c) => c.data.action === "delete")).toHaveLength(1);
  });

  it("surfaces cleanup through the ambient helper", async () => {
    const calls = installClient();
    const lifecycle = cr.createCommentTypingReactionLifecycle({
      cfg: CFG,
      fileToken: "doc2",
      fileType: "docx",
      replyId: "rep2",
    });
    await lifecycle.start();
    await cr.cleanupAmbientCommentTypingReaction({
      cfg: CFG,
      fileToken: "doc2",
      fileType: "docx",
      replyId: "rep2",
    });
    expect(calls.map((c) => c.data.action)).toEqual(["add", "delete"]);
  });
});
