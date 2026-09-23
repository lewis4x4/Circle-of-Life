import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";

import noMonoProse from "../../../eslint-rules/no-mono-prose.mjs";

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(
    code,
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      },
      plugins: { "haven-ui": { rules: { "no-mono-prose": noMonoProse as Rule.RuleModule } } },
      rules: { "haven-ui/no-mono-prose": "error" },
    },
    { filename: "src/app/sample.tsx" },
  );
}

describe("haven-ui/no-mono-prose (COL-656)", () => {
  it.each([
    `export const A = () => <p className="text-[10px] font-mono uppercase">Schedule Engine</p>;`,
    `export const A = ({ on }) => <button className={cn("px-2", on && "font-mono")}>Go</button>;`,
    "export const A = () => <span className={`${x} font-mono`}>12</span>;",
    `const LABEL = "font-mono tracking-widest"; export const A = () => <b className={LABEL}>x</b>;`,
    `export const A = () => <span className="sm:font-mono">x</span>;`,
  ])("flags %s", (code) => {
    expect(lint(code).map((m) => m.ruleId)).toContain("haven-ui/no-mono-prose");
  });

  it.each([
    `export const A = () => <code className="font-mono">GRA-2026-0001</code>;`,
    `export const A = () => <pre className="font-mono text-xs">{json}</pre>;`,
    `export const A = () => <IdText className="font-mono">{mrn}</IdText>;`,
    `export const A = () => <span className="tabular-nums">$4,440</span>;`,
    `export const A = () => <span className="font-monospace-ish">x</span>;`,
  ])("allows %s", (code) => {
    expect(lint(code)).toEqual([]);
  });
});
