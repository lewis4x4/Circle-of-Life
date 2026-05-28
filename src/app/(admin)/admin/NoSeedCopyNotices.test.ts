import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const APP_VISIBLE_NOTICE_SOURCES = [
  "src/components/executive/ceo/CeoDashboardTabs.tsx",
  "src/app/(admin)/executive/cfo/page.tsx",
  "src/app/(admin)/executive/coo/page.tsx",
  "src/components/incidents/AdminIncidentsPageClient.tsx",
  "src/components/v2/W1DashboardClient.tsx",
  "src/components/v2/W2ListClient.tsx",
  "src/components/v2/W3AnalyticsClient.tsx",
  "src/lib/v2-dashboards.ts",
  "src/app/(admin)/admin/rounding/page.tsx",
  "src/app/(admin)/admin/rounding/reports/page.tsx",
  "src/app/(admin)/admin/rounding/live/page.tsx",
  "src/app/(admin)/admin/rounding/plans/page.tsx",
];

const RETIRED_EMPTY_STATE_MARKERS = [
  "No seeded",
  "seeded fallback",
  "fixtures shown",
  "no fixtures shown",
  "fixture value",
];

describe("app-visible no-seed copy notices", () => {
  it("does not expose seed or fixture terminology in live empty-state copy", () => {
    for (const sourcePath of APP_VISIBLE_NOTICE_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of RETIRED_EMPTY_STATE_MARKERS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("keeps neutral live-source fallback wording", () => {
    const sources = APP_VISIBLE_NOTICE_SOURCES.map(readSource).join("\n");

    expect(sources).toContain("No fallback");
    expect(sources).toContain("no fallback rows shown");
    expect(sources).toContain("stay empty while the live source is loading");
  });
});
