import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require("../../src/tools/helpers.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { extractFeishuApiErrorMeta } = require("../../src/core/api-error.js");

describe("formatToolResult — external-content fencing", () => {
  it("fences model-visible text while keeping exact details", () => {
    const result = helpers.formatToolResult({ ok: true, x: "hi" });
    expect(result.content[0].text).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(result.content[0].text).toContain('"ok": true');
    expect(result.details).toEqual({ ok: true, x: "hi" });
  });
});

describe("formatToolError — structured Feishu meta", () => {
  it("emits http_status / feishu_code / feishu_msg / feishu_log_id", () => {
    const err = Object.assign(new Error("Request failed"), {
      response: {
        status: 400,
        data: { code: 99991672, msg: "scope missing", log_id: "log-1" },
      },
    });
    const result = helpers.formatToolError(err);
    expect(result.details).toMatchObject({
      error: "Request failed",
      http_status: 400,
      feishu_code: 99991672,
      feishu_msg: "scope missing",
      feishu_log_id: "log-1",
    });
  });
});

describe("extractFeishuApiErrorMeta", () => {
  it("reads both Axios-style and bare-body shapes", () => {
    expect(extractFeishuApiErrorMeta({ data: { code: 230020, msg: "slow" } })).toMatchObject({
      feishuCode: 230020,
      feishuMsg: "slow",
    });
    expect(extractFeishuApiErrorMeta("plain")).toEqual({ message: "plain" });
  });
});
