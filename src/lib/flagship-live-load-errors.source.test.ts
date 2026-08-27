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
  "src/app/(admin)/admin/rounding/page.tsx",
  "src/app/(admin)/admin/family-messages/page.tsx",
  "src/app/(admin)/executive/standup/page.tsx",
  "src/app/(admin)/executive/league/page.tsx",
  "src/app/(admin)/executive/benchmarks/page.tsx",
  "src/app/(admin)/executive/ceo/page.tsx",
  "src/app/(admin)/executive/standup/[week]/page.tsx",
  "src/app/(admin)/executive/standup/compare/page.tsx",
  "src/app/(admin)/executive/standup/[week]/board/page.tsx",
] as const;

describe("flagship hub live-load errors", () => {
  it.each(FLAGSHIP_LOAD_SOURCES)("uses formatLiveDataLoadError in %s", (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain("formatLiveDataLoadError");
  });
});
