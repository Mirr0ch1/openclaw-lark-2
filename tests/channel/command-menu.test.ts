import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveCommandArgMenuCompat,
  resolveFeishuCommandMenu,
} = require("../../src/channel/command-menu.js");

type Menu = {
  title: string;
  buttons: Array<{ label: string; prompt: string }>;
};

const cfg = { agents: { defaults: {} } };

const resolve = async (text: string): Promise<Menu | undefined> =>
  resolveFeishuCommandMenu({ cfg, agentId: "main", sessionKey: "", text });

describe("core command argument menu → Feishu buttons", () => {
  it("offers the /verbose levels as buttons that inject the command", async () => {
    const menu = await resolve("/verbose");
    expect(menu).toBeDefined();
    expect(menu?.buttons.map((button) => button.prompt)).toEqual([
      "/verbose on",
      "/verbose off",
      "/verbose full",
    ]);
    expect(menu?.title).toContain("/verbose");
  });

  it("accepts the short /v alias", async () => {
    const menu = await resolve("/v");
    expect(menu?.buttons.map((button) => button.prompt)).toContain("/verbose on");
  });

  it("does not offer a menu once the argument is already given", async () => {
    expect(await resolve("/verbose on")).toBeUndefined();
  });

  it("offers no menu for commands without argument choices", async () => {
    expect(await resolve("/help")).toBeUndefined();
    expect(await resolve("/status")).toBeUndefined();
  });

  it("ignores text that is not a command", async () => {
    expect(await resolve("hello there")).toBeUndefined();
    expect(await resolve("")).toBeUndefined();
  });

  it("ignores unknown commands", async () => {
    expect(await resolve("/definitely-not-a-command")).toBeUndefined();
  });

  it("resolves dynamic choices for the session model", async () => {
    const menu = await resolve("/think");
    expect(menu).toBeDefined();
    expect(menu?.buttons.length).toBeGreaterThan(0);
    for (const button of menu?.buttons ?? []) {
      expect(button.prompt.startsWith("/think ")).toBe(true);
    }
  });

  it("prefers the awaited menu API when the host provides it", async () => {
    // Core is retiring the synchronous `resolveCommandArgMenu`; the plugin
    // must use the awaited variant when it exists.
    let called = false;
    const menu = await resolveCommandArgMenuCompat(
      {
        resolveCommandArgMenuAsync: async () => {
          called = true;
          return {
            arg: { name: "mode", description: "mode" },
            choices: [{ value: "on", label: "on" }],
          };
        },
      } as never,
      {} as never,
    );
    expect(called).toBe(true);
    expect(menu?.choices?.[0]?.label).toBe("on");
  });

  it("falls back to the synchronous menu API when the awaited one throws", async () => {
    const fallback = { arg: { name: "mode" }, choices: [{ value: "off", label: "off" }] };
    const menu = await resolveCommandArgMenuCompat(
      {
        resolveCommandArgMenuAsync: async () => {
          throw new Error("boom");
        },
        resolveCommandArgMenu: () => fallback,
      } as never,
      {} as never,
    );
    expect(menu).toBe(fallback);
  });

  it("returns nothing when the host exposes neither API", async () => {
    const menu = await resolveCommandArgMenuCompat({} as never, {} as never);
    expect(menu).toBeUndefined();
  });
});
