import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFeishuCommandMenu } = require("../../src/channel/command-menu.js");

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
});
