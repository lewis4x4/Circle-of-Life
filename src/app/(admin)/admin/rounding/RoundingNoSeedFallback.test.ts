import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const ROUNDING_SOURCES = [
  "src/app/(admin)/admin/rounding/page.tsx",
  "src/app/(admin)/admin/rounding/reports/page.tsx",
  "src/app/(admin)/admin/rounding/live/page.tsx",
  "src/app/(admin)/admin/rounding/plans/page.tsx",
];

const SEEDED_ROUNDING_MARKERS = [
  "DEMO_",
  "useClientDemoMode",
  "Demo mode is active",
  "illustrative sample",
  "Dorothy",
  "Henderson",
  "Robert Chen",
  "Maria Santos",
  "James Wilson",
  "Sarah Kim",
  "Lisa Nguyen",
  "William O'Brien",
  "Sparkline",
  "sparkVariant",
  "sparkline",
];

describe("rounding pages seeded fallback removal", () => {
  it("does not keep demo rounding datasets, demo-mode hooks, or fake trend visuals", () => {
    for (const sourcePath of ROUNDING_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of SEEDED_ROUNDING_MARKERS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("keeps explicit live-source empty states instead of seeded fallback rows", () => {
    const sources = ROUNDING_SOURCES.map(readSource).join("\n");

    expect(sources).toContain("No fallback metrics are shown");
    expect(sources).toContain("No fallback report rows are shown");
    expect(sources).toContain("No fallback tasks are shown");
    expect(sources).toContain("No fallback plans are shown");
  });

  it("does not render healthy or fake-derived statuses for empty live sources", () => {
    const hubSource = readSource("src/app/(admin)/admin/rounding/page.tsx");
    const liveSource = readSource("src/app/(admin)/admin/rounding/live/page.tsx");
    const reportsSource = readSource("src/app/(admin)/admin/rounding/reports/page.tsx");

    expect(hubSource).toContain("summary.expectedCount > 0");
    expect(liveSource).toContain("sourceNotice ? \"No live tasks shown\" : \"All Clear\"");
    expect(reportsSource).not.toContain("Select a broader window.");
    expect(reportsSource).toContain("No live rows returned");
  });
});
