import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

// @ts-expect-error — the rule file is .mjs and has no .d.ts
import requireKpiInfo from "../../../../eslint-rules/require-kpi-info.mjs";

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(
    code,
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        "ui-v2": { rules: { "require-kpi-info": requireKpiInfo } },
      },
      rules: {
        "ui-v2/require-kpi-info": "error",
      },
    },
    { filename: "KPITile.fixture.tsx" },
  );
}

describe("require-kpi-info ESLint rule", () => {
  it("reports when KPITile has a computed value without info", () => {
    const messages = lint(
      `import { KPITile } from "./KPITile";
       const computed = 1;
       export const X = () => <KPITile label="x" value={computed} />;`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toMatch(/info tooltip/i);
  });

  it("allows computed value when info is provided", () => {
    const messages = lint(
      `import { KPITile } from "./KPITile";
       const computed = 1;
       export const X = () => <KPITile label="x" value={computed} info="ok" />;`,
    );
    expect(messages).toHaveLength(0);
  });

  it("allows literal value without info", () => {
    const messages = lint(
      `import { KPITile } from "./KPITile";
       export const X = () => <KPITile label="x" value={7} />;`,
    );
    expect(messages).toHaveLength(0);
  });

  it("allows string-literal value without info", () => {
    const messages = lint(
      `import { KPITile } from "./KPITile";
       export const X = () => <KPITile label="x" value="99" />;`,
    );
    expect(messages).toHaveLength(0);
  });
});
