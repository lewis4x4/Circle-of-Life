import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";

import requireTimeZone from "../../../eslint-rules/require-time-zone.mjs";

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(
    code,
    {
      files: ["**/*.ts"],
      languageOptions: { parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
      plugins: { "haven-time": { rules: { "require-time-zone": requireTimeZone as Rule.RuleModule } } },
      rules: { "haven-time/require-time-zone": "error" },
    },
    { filename: "src/lib/sample.ts" },
  );
}

describe("haven-time/require-time-zone", () => {
  it.each([
    // The incidents board bug: server = UTC, client = local.
    `const OPTS = { month: "short", hour: "numeric" }; new Intl.DateTimeFormat("en-US", OPTS).format(d);`,
    `new Intl.DateTimeFormat("en-US").format(d);`,
    `Intl.DateTimeFormat("en-US", { dateStyle: "medium" });`,
    `d.toLocaleDateString("en-US", { month: "short", day: "numeric" });`,
    `d.toLocaleDateString();`,
    `d.toLocaleTimeString("en-US");`,
    `new Date(x).toLocaleString();`,
    `value.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });`,
    `const BASE = { month: "short" }; d.toLocaleDateString("en-US", { ...BASE, day: "numeric" });`,
  ])("flags %s", (code) => {
    expect(lint(code)).toHaveLength(1);
  });

  it.each([
    `new Intl.DateTimeFormat("en-US", { month: "short", timeZone: tz }).format(d);`,
    `const OPTS = { hour: "numeric", timeZone: "UTC" }; new Intl.DateTimeFormat("en-US", OPTS);`,
    `const BASE = { timeZone: tz }; d.toLocaleDateString("en-US", { ...BASE, day: "numeric" });`,
    `d.toLocaleDateString("en-US", options);`,
    `count.toLocaleString();`,
    `amount.toLocaleString("en-US", { style: "currency", currency: "USD" });`,
    `new Intl.NumberFormat("en-US").format(n);`,
  ])("allows %s", (code) => {
    expect(lint(code)).toHaveLength(0);
  });
});

describe("the require-time-zone baseline stays empty (COL-684)", () => {
  it("has no suppressed call sites left in eslint-suppressions.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const suppressions = JSON.parse(readFileSync(resolve(__dirname, "../../../eslint-suppressions.json"), "utf8")) as Record<
      string,
      Record<string, { count: number }>
    >;
    const suppressed = Object.entries(suppressions)
      .filter(([, rules]) => (rules["haven-time/require-time-zone"]?.count ?? 0) > 0)
      .map(([file]) => file);
    // Format through @/lib/format/datetime instead of suppressing the rule.
    expect(suppressed).toEqual([]);
  });
});
