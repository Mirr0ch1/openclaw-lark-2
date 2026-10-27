import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  FEISHU_PRESENTATION_CAPABILITIES,
  buildFeishuButtonsCard,
  buildPresentationCard,
  resolvePresentationButtonAction,
} = require("../../src/card/presentation-card.js");

type CardButton = {
  text: { content: string };
  value?: { action: string; prompt: string };
  behaviors?: Array<{ type: string; default_url: string }>;
};

type CardElement = {
  tag: string;
  content?: string;
  text_size?: string;
  columns?: Array<{ elements: CardButton[] }>;
};

/** Buttons of a card, flattened out of their `column_set` rows. */
const buttonsOf = (card: Card | undefined): CardButton[] =>
  elementsOf(card, "column_set").flatMap((element) =>
    (element.columns ?? []).flatMap((column) => column.elements),
  );

type Card = {
  schema: string;
  header?: { title: { content: string } };
  body: { elements: CardElement[] };
};

const elementsOf = (card: Card | undefined, tag: string): CardElement[] =>
  (card?.body?.elements ?? []).filter((element) => element.tag === tag);

const firstElement = (card: Card | undefined, tag: string): CardElement | undefined =>
  elementsOf(card, tag)[0];

describe("presentation → Feishu card", () => {
  it("advertises tables, buttons and dividers but not charts", () => {
    expect(FEISHU_PRESENTATION_CAPABILITIES.tables).toBe(true);
    expect(FEISHU_PRESENTATION_CAPABILITIES.buttons).toBe(true);
    expect(FEISHU_PRESENTATION_CAPABILITIES.divider).toBe(true);
    // Feishu has no native chart element, so core must downgrade charts.
    expect(FEISHU_PRESENTATION_CAPABILITIES.charts).toBe(false);
  });

  it("renders a table block as a markdown table Feishu can draw", () => {
    const card: Card = buildPresentationCard({
      title: "OpenClaw 2026.10.7",
      blocks: [
        {
          type: "table",
          caption: "Session status",
          headers: ["Item", "Value"],
          rows: [["🧠 Model", "m3.1"], ["💵 Cost", "$0.01"]],
          rowHeaderColumnIndex: 0,
        },
      ],
    });
    expect(card.schema).toBe("2.0");
    expect(card.header?.title.content).toBe("OpenClaw 2026.10.7");
    const markdown = firstElement(card, "markdown");
    expect(markdown?.content).toContain("| Item | Value |");
    expect(markdown?.content).toContain("| --- | --- |");
    expect(markdown?.content).toContain("| 🧠 Model | m3.1 |");
    expect(markdown?.content).toContain("Session status");
  });

  it("escapes pipes so a cell cannot break the table", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        { type: "table", caption: "", headers: ["A", "B"], rows: [["x|y", "z"]] },
      ],
    });
    expect(firstElement(card, "markdown")?.content).toContain("x\\|y");
  });

  it("renders context blocks in notation size and text blocks in normal size", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        { type: "context", text: "low emphasis" },
        { type: "text", text: "normal" },
      ],
    });
    const [context, text] = elementsOf(card, "markdown");
    expect(context?.text_size).toBe("notation");
    expect(text?.text_size).toBeUndefined();
  });

  it("renders a divider as an hr element", () => {
    const card: Card = buildPresentationCard({ blocks: [{ type: "divider" }] });
    expect(elementsOf(card, "hr")).toHaveLength(1);
  });

  it("maps a command action to an inject_prompt button", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "buttons",
          buttons: [{ label: "on", action: { type: "command", command: "/verbose on" } }],
        },
      ],
    });
    const [button] = buttonsOf(card);
    expect(button?.value).toEqual({ action: "inject_prompt", prompt: "/verbose on" });
    expect(button?.text.content).toBe("on");
  });

  it("maps a url action to an open_url button behaviour", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "buttons",
          buttons: [{ label: "open", action: { type: "url", url: "https://example.com/x" } }],
        },
      ],
    });
    expect(buttonsOf(card)[0]?.behaviors).toEqual([
      { type: "open_url", default_url: "https://example.com/x" },
    ]);
  });

  it("keeps non-http url actions out of the button behaviour", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "buttons",
          buttons: [{ label: "bad", action: { type: "url", url: "javascript:alert(1)" } }],
        },
      ],
    });
    expect(buttonsOf(card)).toHaveLength(0);
  });

  it("renders opaque controls as text instead of guessing a behaviour", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "buttons",
          buttons: [
            { label: "allow", action: { type: "approval", approvalId: "a1", approvalKind: "exec", decision: "allow-once" } },
            { label: "go", action: { type: "command", command: "/go" } },
          ],
        },
      ],
    });
    const buttons = buttonsOf(card);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.text.content).toBe("go");
    const markdown = elementsOf(card, "markdown");
    expect(markdown.some((element) => element.content?.includes("- allow"))).toBe(true);
  });

  it("renders a select block as a button row", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "select",
          placeholder: "pick",
          options: [
            { label: "a", action: { type: "command", command: "/pick a" } },
            { label: "b", action: { type: "command", command: "/pick b" } },
          ],
        },
      ],
    });
    const prompts = buttonsOf(card).map((button) => button.value?.prompt);
    expect(prompts).toEqual(["/pick a", "/pick b"]);
  });

  it("chunks buttons into rows of at most three", () => {
    const card: Card = buildPresentationCard({
      blocks: [
        {
          type: "buttons",
          buttons: ["a", "b", "c", "d"].map((label) => ({
            label,
            action: { type: "command", command: `/x ${label}` },
          })),
        },
      ],
    });
    const rows = elementsOf(card, "column_set");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.columns).toHaveLength(3);
    expect(rows[1]?.columns).toHaveLength(1);
  });

  it("returns undefined when there is nothing renderable", () => {
    expect(buildPresentationCard({ blocks: [] })).toBeUndefined();
    expect(buildPresentationCard({ blocks: [{ type: "text", text: "  " }] })).toBeUndefined();
  });

  it("keeps tables past the Feishu limit visible as a code block", () => {
    const table = (name: string) => ({
      type: "table",
      caption: name,
      headers: ["A"],
      rows: [["1"]],
    });
    const card: Card = buildPresentationCard({
      blocks: [table("one"), table("two"), table("three"), table("four")],
    });
    const markdown = elementsOf(card, "markdown");
    // The first three render as tables; the fourth is degraded, not dropped.
    const asTable = markdown.filter(
      (element) => element.content?.includes("| A |") && !element.content?.includes("```"),
    );
    expect(asTable).toHaveLength(3);
    expect(markdown.some((element) => element.content?.includes("```"))).toBe(true);
    expect(markdown.some((element) => element.content?.includes("four"))).toBe(true);
  });

  it("resolves button actions without a canonical action field", () => {
    expect(resolvePresentationButtonAction({ label: "x", value: "v" })).toEqual({
      kind: "opaque",
      value: "v",
    });
    expect(resolvePresentationButtonAction({ label: "x", url: "https://e.com" })).toEqual({
      kind: "url",
      url: "https://e.com",
    });
  });

  it("opens a web-app action that carries a URL", () => {
    expect(
      resolvePresentationButtonAction({
        label: "open",
        action: { type: "web-app", url: "https://app.example/x" },
      }),
    ).toEqual({ kind: "url", url: "https://app.example/x" });
    expect(
      resolvePresentationButtonAction({
        label: "open",
        action: { type: "web-app", widgetId: "w1" },
      }),
    ).toEqual({ kind: "opaque" });
  });

  it("counts a markdown table inside a text block against the card's table budget", () => {
    // Feishu's limit is on *rendered* tables, so a table inside a text block
    // counts too. With the budget spent, the text's table degrades to a code
    // block instead of making Feishu reject the whole card.
    const card: Card = buildPresentationCard({
      blocks: [
        { type: "table", caption: "one", headers: ["A"], rows: [["1"]] },
        { type: "table", caption: "two", headers: ["A"], rows: [["2"]] },
        { type: "table", caption: "three", headers: ["A"], rows: [["3"]] },
        { type: "text", text: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
      ],
    });
    const markdown = elementsOf(card, "markdown");
    const asTable = markdown.filter(
      (element) => element.content?.includes("| A |") && !element.content?.includes("```"),
    );
    expect(asTable).toHaveLength(3);
    const degraded = markdown.find((element) => element.content?.includes("```"));
    expect(degraded?.content).toContain("| a | b |");
  });
});

describe("button card", () => {
  it("builds one inject_prompt button per entry", () => {
    const card: Card = buildFeishuButtonsCard({
      text: "Choose a mode",
      buttons: [{ label: "on", prompt: "/verbose on" }],
    });
    expect(firstElement(card, "markdown")?.content).toBe("Choose a mode");
    expect(buttonsOf(card)[0]?.value).toEqual({
      action: "inject_prompt",
      prompt: "/verbose on",
    });
  });

  it("ignores entries without a usable label or prompt", () => {
    expect(
      buildFeishuButtonsCard({
        buttons: [
          { label: "", prompt: "/x" },
          { label: "ok", prompt: "  " },
        ],
      }),
    ).toBeUndefined();
  });
});
