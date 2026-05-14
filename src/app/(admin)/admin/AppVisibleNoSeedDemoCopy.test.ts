import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const APP_VISIBLE_COPY_SOURCES = [
  "src/app/(admin)/search/page.tsx",
  "src/lib/grace/GraceBar.tsx",
  "src/lib/grace/templates.ts",
];

const SEEDED_SITE_MARKERS = [
  "Oakridge",
  "Grande Cypress",
  "Plantation",
  "Rising Oaks",
];

const FINANCE_DEMO_MARKERS = [
  "useClientDemoMode",
  "Sysco Foods Corp",
  "INV-{",
  "Q2 Active",
  "16 Days remaining",
  "sample vendor lines",
  "non-demo mode",
  "Sparkline",
  "?? 0",
];

describe("app-visible copy does not carry seeded demo examples", () => {
  it("does not suggest legacy seeded facilities in Search or Grace prompts", () => {
    for (const sourcePath of APP_VISIBLE_COPY_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of SEEDED_SITE_MARKERS) {
        expect(source, `${sourcePath} still contains seeded marker ${marker}`).not.toContain(marker);
      }
    }
  });

  it("keeps Finance on live-record messaging without dormant demo branches", () => {
    const source = readSource("src/components/finance/FinanceOverviewPageClient.tsx");

    for (const marker of FINANCE_DEMO_MARKERS) {
      expect(source, `Finance still contains demo marker ${marker}`).not.toContain(marker);
    }

    expect(source).toContain("from live billing records");
    expect(source).toContain("from live finance records");
    expect(source).toContain("postedCount != null");
    expect(source).toContain("unpostedInvoices != null");
  });

  it("does not keep the unused executive demo toggle component", () => {
    expect(
      existsSync(path.join(repoRoot, "src/components/executive/demo-toggle.tsx"))
    ).toBe(false);
  });
});
