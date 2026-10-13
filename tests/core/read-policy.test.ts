import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rp = require("../../src/core/read-policy.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getLarkAccount } = require("../../src/core/accounts.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withTicket } = require("../../src/core/lark-ticket.js");

function makeAccount(feishu: Record<string, unknown> = {}) {
  const cfg = { channels: { feishu: { appId: "cli_x", appSecret: "sec_x", ...feishu } } };
  return { cfg, account: getLarkAccount(cfg, "default") };
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "default",
    currentChannelId: "oc_current",
    requesterAccountId: "default",
    requesterSenderId: "ou_me",
    directOperator: false,
    ...overrides,
  };
}

describe("resolveFeishuChatType", () => {
  it("maps chat_mode 'topic' to a group (not a p2p via chat_type visibility)", () => {
    expect(rp.resolveFeishuChatType({ chat_mode: "topic" })).toBe("group");
    expect(rp.resolveFeishuChatType({ chat_mode: "topic", chat_type: "private" })).toBe("group");
    expect(rp.resolveFeishuChatType({ chat_mode: "group" })).toBe("group");
    expect(rp.resolveFeishuChatType({ chat_mode: "p2p" })).toBe("p2p");
    expect(rp.resolveFeishuChatType({ chat_type: "group" })).toBe("group");
    expect(rp.resolveFeishuChatType({ chat_type: "topic_group" })).toBe("group");
    // Visibility-only values carry no conversation-kind information.
    expect(rp.resolveFeishuChatType({ chat_type: "private" })).toBeUndefined();
  });

  it("applies group policy to a non-current topic group", () => {
    const { cfg, account } = makeAccount({ groupPolicy: "disabled" });
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_topic",
      chatType: rp.resolveFeishuChatType({ chat_mode: "topic" }),
    });
    // Must be judged as a group (denied by policy), not as a readable DM.
    expect(decision.decision).toBe("deny");
  });
});

describe("isCurrentFeishuChat", () => {
  it("is true only for the originating conversation", () => {
    const { account } = makeAccount();
    expect(rp.isCurrentFeishuChat({ account, chatId: "oc_current", ctx: ctx() })).toBe(true);
    expect(rp.isCurrentFeishuChat({ account, chatId: "oc_other", ctx: ctx() })).toBe(false);
  });
});

describe("resolveFeishuChatReadPreliminaryAuthorization", () => {
  it("allows the current conversation", () => {
    const { cfg, account } = makeAccount();
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_current",
      chatType: "group",
    });
    expect(decision.decision).toBe("allow");
  });

  it("still denies the current group when the group policy is disabled", () => {
    // Official semantics: `disabled` short-circuits before the current-chat
    // allowance — the account does not operate in groups at all.
    const { cfg, account } = makeAccount({ groupPolicy: "disabled" });
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_current",
      chatType: "group",
    });
    expect(decision.decision).toBe("deny");
  });

  it("denies a non-current DM without an allowFrom wildcard", () => {
    const { cfg, account } = makeAccount();
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
      chatType: "p2p",
    });
    expect(decision.decision).toBe("deny");
  });

  it("allows a non-current DM when allowFrom is a wildcard", () => {
    const { cfg, account } = makeAccount({ allowFrom: ["*"] });
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
      chatType: "p2p",
    });
    expect(decision.decision).toBe("allow");
  });

  it("allows a non-current group under the open policy, denies when disabled", () => {
    const open = makeAccount();
    expect(
      rp.resolveFeishuChatReadPreliminaryAuthorization({
        cfg: open.cfg,
        account: open.account,
        ctx: ctx(),
        chatId: "oc_other",
        chatType: "group",
      }).decision,
    ).toBe("allow");

    const disabled = makeAccount({ groupPolicy: "disabled" });
    expect(
      rp.resolveFeishuChatReadPreliminaryAuthorization({
        cfg: disabled.cfg,
        account: disabled.account,
        ctx: ctx(),
        chatId: "oc_other",
        chatType: "group",
      }).decision,
    ).toBe("deny");
  });

  it("allows an explicitly configured group under the allowlist policy", () => {
    const { cfg, account } = makeAccount({
      groupPolicy: "allowlist",
      groups: { oc_known: { enabled: true } },
    });
    expect(
      rp.resolveFeishuChatReadPreliminaryAuthorization({
        cfg,
        account,
        ctx: ctx(),
        chatId: "oc_known",
        chatType: "group",
      }).decision,
    ).toBe("allow");
  });

  it("requests metadata when the type is unknown and the two branches disagree", () => {
    const { cfg, account } = makeAccount(); // open groups, no DM wildcard
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
    });
    expect(decision.decision).toBe("needs-metadata");
  });
});

describe("authorizeFeishuChatMemberRead", () => {
  it("allows group enumeration once the group is readable", () => {
    const { cfg, account } = makeAccount();
    const authorization = rp.authorizeFeishuChatMemberRead({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
      chatType: "group",
    });
    expect(authorization).toEqual({ kind: "group", chatId: "oc_other" });
  });

  it("limits a direct chat to the current sender", () => {
    const { cfg, account } = makeAccount();
    const authorization = rp.authorizeFeishuChatMemberRead({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_current",
      chatType: "p2p",
    });
    expect(authorization).toEqual({
      kind: "direct",
      chatId: "oc_current",
      memberId: "ou_me",
      memberIdType: "open_id",
    });
  });

  it("rejects a direct-chat member read for anyone but the sender", () => {
    const { cfg, account } = makeAccount();
    expect(() =>
      rp.authorizeFeishuChatMemberRead({
        cfg,
        account,
        ctx: ctx(),
        chatId: "oc_current",
        chatType: "p2p",
        memberId: "ou_someone_else",
      }),
    ).toThrow(/limited to the current sender/);
  });

  it("rejects a non-current direct chat outright", () => {
    const { cfg, account } = makeAccount({ allowFrom: ["*"] });
    expect(() =>
      rp.authorizeFeishuChatMemberRead({
        cfg,
        account,
        ctx: ctx(),
        chatId: "oc_other",
        chatType: "p2p",
      }),
    ).toThrow(/current conversation/);
  });

  it("rejects member reads when the chat type is unknown", () => {
    // The chat-read assertion runs first, so an unresolvable type surfaces as a
    // plain denial (no existence oracle) rather than the type-specific error.
    const { cfg, account } = makeAccount();
    expect(() =>
      rp.authorizeFeishuChatMemberRead({
        cfg,
        account,
        ctx: ctx(),
        chatId: "oc_somewhere",
      }),
    ).toThrow(/not allowed/);
  });
});

describe("readFeishuChatInfoWithAuthorization", () => {
  it("rethrows a lookup failure as a denial when metadata was required", async () => {
    const { cfg, account } = makeAccount();
    const preliminary = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_ghost",
    });
    expect(preliminary.decision).toBe("needs-metadata");
    await expect(
      rp.readFeishuChatInfoWithAuthorization(
        { cfg, account, ctx: ctx(), preliminary },
        async () => {
          throw new Error("not found");
        },
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it("returns the chat when the resolved type is readable", async () => {
    const { cfg, account } = makeAccount();
    const preliminary = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
    });
    const chat = await rp.readFeishuChatInfoWithAuthorization(
      { cfg, account, ctx: ctx(), preliminary },
      async () => ({ chat_mode: "group", chat_type: "public" }),
    );
    expect(chat.chat_mode).toBe("group");
  });
});

describe("account isolation and disabled groups", () => {
  it("does not treat a chat as current when the ticket came from another account", () => {
    // Same chat id, different account → the "current conversation" allowance
    // must not apply; the ordinary group policy decides instead.
    const { cfg, account } = makeAccount({ groupPolicy: "allowlist" });
    const foreignCtx = ctx({ accountId: "other", requesterAccountId: "other" });
    expect(rp.isCurrentFeishuChat({ account, chatId: "oc_current", ctx: foreignCtx })).toBe(false);
    expect(
      rp.resolveFeishuChatReadPreliminaryAuthorization({
        cfg,
        account,
        ctx: foreignCtx,
        chatId: "oc_current",
        chatType: "group",
      }).decision,
    ).toBe("deny");
  });

  it("denies a disabled group even for its own conversation", () => {
    const { cfg, account } = makeAccount({ groups: { oc_current: { enabled: false } } });
    const decision = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_current",
      chatType: "group",
    });
    expect(decision.decision).toBe("deny");
  });
});

describe("authorizeFeishuChatMemberRead — identifier guards", () => {
  it("allows the sender's own id in a direct chat", () => {
    const { cfg, account } = makeAccount();
    const authorization = rp.authorizeFeishuChatMemberRead({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_current",
      chatType: "p2p",
      memberId: "ou_me",
    });
    expect(authorization.kind).toBe("direct");
  });

  it("rejects a mismatched identifier type in a direct chat", () => {
    const { cfg, account } = makeAccount();
    expect(() =>
      rp.authorizeFeishuChatMemberRead({
        cfg,
        account,
        ctx: ctx(),
        chatId: "oc_current",
        chatType: "p2p",
        memberIdType: "user_id",
      }),
    ).toThrow(/must match the current sender/);
  });
});

describe("readFeishuChatInfoWithAuthorization — allowed path", () => {
  it("rethrows the original lookup error when metadata was not required", async () => {
    const { cfg, account } = makeAccount();
    const preliminary = rp.resolveFeishuChatReadPreliminaryAuthorization({
      cfg,
      account,
      ctx: ctx(),
      chatId: "oc_other",
      chatType: "group",
    });
    expect(preliminary.decision).toBe("allow");
    await expect(
      rp.readFeishuChatInfoWithAuthorization(
        { cfg, account, ctx: ctx(), preliminary },
        async () => {
          throw new Error("upstream 500");
        },
      ),
    ).rejects.toThrow(/upstream 500/);
  });
});

describe("resolveFeishuReadContext", () => {
  it("reconstructs the context from the active LarkTicket", () => {
    const out = withTicket(
      {
        messageId: "om_1",
        chatId: "oc_ticketed",
        accountId: "default",
        startTime: Date.now(),
        senderOpenId: "ou_me",
        chatType: "group",
      },
      () => rp.resolveFeishuReadContext(),
    );
    expect(out.currentChannelId).toBe("oc_ticketed");
    expect(out.requesterSenderId).toBe("ou_me");
    expect(out.currentChatType).toBe("group");
    expect(out.directOperator).toBe(false);
  });
});
