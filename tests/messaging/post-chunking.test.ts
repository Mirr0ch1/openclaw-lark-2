import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  chunkFeishuPostMarkdown,
  postContentBytes,
  FEISHU_POST_MAX_BYTES,
} = require("../../src/messaging/outbound/post-chunking.js");

describe("envelope-aware post chunking", () => {
  it("keeps a small post as a single chunk", () => {
    expect(chunkFeishuPostMarkdown({ text: "hello", limit: 15000 })).toEqual(["hello"]);
  });

  it("splits a CJK post that fits by chars but not by bytes", () => {
    const text = "中".repeat(12000); // 12000 chars (< limit) but ~36 KB UTF-8
    expect(text.length).toBeLessThanOrEqual(15000);
    expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(FEISHU_POST_MAX_BYTES);

    const chunks = chunkFeishuPostMarkdown({ text, limit: 15000 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(postContentBytes(chunk)).toBeLessThanOrEqual(FEISHU_POST_MAX_BYTES);
      expect(chunk.length).toBeLessThanOrEqual(15000); // char limit still honoured
    }
    expect(chunks.join("")).toBe(text);
  });
});
