import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const FLAGSHIP_LOAD_SOURCES = [
  "src/app/(admin)/billing/page.tsx",
  "src/app/(admin)/billing/billing-invoice-ledger.tsx",
  "src/app/(admin)/admin/dietary/page.tsx",
  "src/components/dietary/AdminDietaryPageClient.tsx",
  "src/components/family-portal/FamilyNotesPanel.tsx",
  "src/app/(admin)/executive/standup/page.tsx",
  "src/app/(admin)/executive/league/page.tsx",
  "src/app/(admin)/executive/benchmarks/page.tsx",
  "src/app/(admin)/executive/ceo/page.tsx",
  "src/app/(admin)/executive/standup/[week]/page.tsx",
  "src/app/(admin)/executive/standup/compare/page.tsx",
  "src/app/(admin)/executive/standup/[week]/board/page.tsx",
] as const;

/**
 * Smart Rounding is not in the list above. `/admin/rounding` is the Live board
 * and its reads live in `useLiveBoardData`, which goes through
 * `logRoundingQueryFailure` instead: spec 25A decision D23 requires the module
 * to log the underlying PostgREST code alongside the operator sentence, because
 * the generic message hid three unrelated query defects for long enough that a
 * spec was written blaming a fourth cause.
 */
const ROUNDING_LOAD_SOURCES = [
  "src/hooks/useLiveBoardData.ts",
  "src/app/(admin)/admin/rounding/monitoring-orders/page.tsx",
  "src/app/(admin)/admin/rounding/integrity/page.tsx",
] as const;

describe("flagship hub live-load errors", () => {
  it.each(FLAGSHIP_LOAD_SOURCES)("uses formatLiveDataLoadError in %s", (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain("formatLiveDataLoadError");
  });

  it.each(ROUNDING_LOAD_SOURCES)("logs the underlying query code in %s", (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain("logRoundingQueryFailure");
    expect(source).not.toContain("formatLiveDataLoadError");
  });
});
