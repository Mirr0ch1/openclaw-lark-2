import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveSafeFeishuButtonUrl,
  sanitizeNativeFeishuCard,
  sanitizeModelAuthoredCard,
} = require("../../src/card/native-card.js");

describe("native-card sanitisation", () => {
  it("allows only http(s) button urls", () => {
    expect(resolveSafeFeishuButtonUrl("javascript:alert(1)")).toBeUndefined();
    expect(resolveSafeFeishuButtonUrl("data:text/html,x")).toBeUndefined();
    expect(resolveSafeFeishuButtonUrl("https://ok.example")).toBe("https://ok.example");
    expect(resolveSafeFeishuButtonUrl("http://ok.example")).toBe("http://ok.example");
  });

  it("drops buttons whose callback value is not an ocf1 envelope", () => {
    const card = {
      schema: "2.0",
      body: {
        elements: [
          { tag: "button", text: { tag: "plain_text", content: "go" }, value: { oc: "evil" } },
        ],
      },
    };
    expect(sanitizeNativeFeishuCard(card)).toBeUndefined();
  });

  it("keeps ocf1 callbacks and normalises v1 to v2", () => {
    const card = {
      elements: [
        { tag: "button", text: { tag: "plain_text", content: "go" }, value: { oc: "ocf1", a: "x" } },
      ],
    };
    const out: any = sanitizeNativeFeishuCard(card);
    expect(out.schema).toBe("2.0");
    expect(out.body.elements[0].behaviors).toContainEqual({
      type: "callback",
      value: { oc: "ocf1", a: "x" },
    });
  });

  it("escapes markdown and drops unsupported elements", () => {
    const card = {
      elements: [
        { tag: "markdown", content: "<script>x</script>" },
        { tag: "img", img_key: "k" },
      ],
    };
    const out: any = sanitizeNativeFeishuCard(card);
    expect(out.body.elements).toHaveLength(1);
    expect(out.body.elements[0].content).toContain("&lt;script&gt;");
  });

  it("passes a valid template card through but rejects unusable cards", () => {
    const tpl = { type: "template", data: { template_id: "t1" } };
    expect(sanitizeModelAuthoredCard(tpl)).toEqual(tpl);
    // A template card without a template_id carries nothing renderable.
    expect(sanitizeModelAuthoredCard({ type: "template" })).toBeUndefined();
    expect(sanitizeModelAuthoredCard({ type: "template", data: { template_id: "  " } })).toBeUndefined();
    expect(sanitizeModelAuthoredCard({ elements: [{ tag: "img", img_key: "k" }] })).toBeUndefined();
  });
});
