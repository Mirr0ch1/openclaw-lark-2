import { describe, it, expect } from "vitest";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkUndefinedIdentifiers } = require("../../scripts/check-undef.js");

const pluginRoot = path.resolve(__dirname, "../..");

describe("no undefined identifiers in the implementation files", () => {
  it("finds none", () => {
    const result = checkUndefinedIdentifiers(pluginRoot);
    if (!result.available) {
      // The published plugin ships without devDependencies; the guard is
      // armed in the development checkout, where `npm install` brings
      // typescript in.
      console.warn(
        "[skip] typescript is not installed — run `npm install` in the plugin root to arm the undefined-identifier guard",
      );
      return;
    }
    const report = result.offenders
      .map((offender: { file: string; line: number; column: number; message: string }) =>
        `${offender.file}:${offender.line}:${offender.column}  ${offender.message}`,
      )
      .join("\n");
    expect(result.offenders, report).toEqual([]);
  });
});
