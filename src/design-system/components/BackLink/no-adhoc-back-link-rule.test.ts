import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";

import noAdhocBackLink from "../../../../eslint-rules/no-adhoc-back-link.mjs";

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(
    code,
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      },
      plugins: { "haven-back-link": { rules: { "no-adhoc-back-link": noAdhocBackLink as Rule.RuleModule } } },
      rules: { "haven-back-link/no-adhoc-back-link": "error" },
    },
    { filename: "src/app/sample.tsx" },
  );
}

describe("haven-back-link/no-adhoc-back-link (COL-656)", () => {
  it.each([
    `export const A = () => <Link href="/q">← Queue</Link>;`,
    `export const A = () => <a href="/a">‹ Back to admissions</a>;`,
    `export const A = () => <Link href="/p"><span>BACK TO PROFILE</span></Link>;`,
    `export const A = () => <Link href="/e"><ArrowLeft className="h-4 w-4" /> Executive</Link>;`,
    `export const A = () => <a href="/h"><ChevronLeft /> Hub</a>;`,
  ])("flags %s", (code) => {
    expect(lint(code).map((m) => m.ruleId)).toContain("haven-back-link/no-adhoc-back-link");
  });

  it.each([
    `export const A = () => <BackLink label="Admissions" href="/admin/admissions" />;`,
    `export const A = () => <PageHeader title="Queue" backLink={{ label: "Admissions", href: "/a" }} />;`,
    `export const A = () => <Button onClick={prev}><ChevronLeft /> Previous month</Button>;`,
    `export const A = () => <p>Go back to the list when done.</p>;`,
  ])("allows %s", (code) => {
    expect(lint(code)).toEqual([]);
  });
});
