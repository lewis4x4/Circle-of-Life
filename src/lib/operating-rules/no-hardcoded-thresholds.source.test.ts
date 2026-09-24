/**
 * COL-710 guard: the thresholds that became operating rules must not creep
 * back in as literals in the code that consumes them. The values live in
 * `public.operating_rules` (migration 491) and are changed on
 * Settings → Threshold targets.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

/** Drop comments so an explanation of the old value is not a finding. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CONSUMERS: Array<{ file: string; forbidden: RegExp[]; mustUse: string }> = [
  {
    file: "src/lib/risk/risk-display-copy.ts",
    forbidden: [/<\s*50\b/, /<\s*70\b/, /<\s*85\b/],
    mustUse: "riskLevelFromBands",
  },
  {
    file: "supabase/functions/risk-nightly-scorer/index.ts",
    forbidden: [/>=\s*85\b/, />=\s*70\b/, />=\s*50\b/, /score_lte:\s*\d/, /critical_score_lte:\s*\d/],
    mustUse: "riskLevelFromBands",
  },
  {
    file: "src/lib/office/survey-binder.ts",
    forbidden: [/DaysFromToday\(\s*60\b/, /in60Iso/],
    mustUse: "dueWindowDays",
  },
  {
    file: "src/lib/office/survey-binder-display-copy.ts",
    forbidden: [/≤60d/],
    mustUse: "dueWindowDays",
  },
  {
    file: "src/components/compliance/AdminCompliancePageClient.tsx",
    forbidden: [/<\s*75\b/, /score\s*<\s*\d/],
    mustUse: "loadComplianceScoreAlert",
  },
];

describe("thresholds are operating rules, not literals (COL-710)", () => {
  it.each(CONSUMERS)("$file reads the rule instead of a fixed number", ({ file, forbidden, mustUse }) => {
    const source = code(read(file));
    for (const pattern of forbidden) {
      expect(source, `${file} contains ${pattern}`).not.toMatch(pattern);
    }
    expect(source).toContain(mustUse);
  });
});
