import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

// @ts-expect-error — the rule file is .mjs and has no .d.ts
import noDirectPrimitiveImport from "../../../eslint-rules/no-direct-primitive-import.mjs";

function lint(code: string, filename = "src/app/(admin)/admin/v2/sample/page.tsx") {
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
        "ui-v2": { rules: { "no-direct-primitive-import": noDirectPrimitiveImport } },
      },
      rules: { "ui-v2/no-direct-primitive-import": "error" },
    },
    { filename },
  );
}

describe("no-direct-primitive-import ESLint rule", () => {
  it("blocks direct primitive imports without a template import", () => {
    const messages = lint(
      `import { KPITile } from "@/design-system/components/KPITile";
       export const Page = () => <KPITile label="x" value={1} />;`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toMatch(/templates/i);
  });

  it("allows component imports when paired with a template import", () => {
    // Use a value-import (not `import type`) so the base ESLint parser without
    // typescript-eslint accepts the syntax. The rule logic is structural —
    // any import from components/** plus any import from templates/** suffices.
    const messages = lint(
      `import { T1Dashboard } from "@/design-system/templates";
       import { KPITile } from "@/design-system/components/KPITile";
       export const Page = () => <T1Dashboard />;`,
    );
    expect(messages).toHaveLength(0);
  });

  it("allows template-only imports", () => {
    const messages = lint(
      `import { T2List } from "@/design-system/templates";
       export const Page = () => <T2List />;`,
    );
    expect(messages).toHaveLength(0);
  });

  it("ignores files outside the v2 admin scope (rule is plugin-level — runner controls scope)", () => {
    // The rule itself doesn't check file paths; eslint.config.mjs scopes it to
    // src/app/(admin)/admin/v2/**. Here we verify the rule's body is path-agnostic
    // so the config is the source of truth.
    const messages = lint(
      `import { KPITile } from "@/design-system/components/KPITile";
       export const Page = () => <KPITile />;`,
      "src/app/(admin)/some-other-page.tsx",
    );
    expect(messages).toHaveLength(1);
  });
});
