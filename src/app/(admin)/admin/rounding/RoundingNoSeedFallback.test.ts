import { formatRoundingPlansNoPlansEmptyTitle } from "@/lib/rounding/rounding-plans-display-copy";
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
    const cadenceLib = readSource("src/lib/rounding/col-discovery-round-cadence.ts");

    expect(sources).toContain("describeLiveBoardEmptyState");
    expect(cadenceLib).toContain("No live tasks in the last 12 hours");
    expect(sources).toContain("No reports generated yet");
    expect(sources).toContain("No checks match the current filter");
    expect(sources).toContain("formatRoundingPlansNoPlansEmptyTitle");
    expect(formatRoundingPlansNoPlansEmptyTitle({ kind: "named", name: "Test facility" })).toBe("No observation plans at Test facility");
  });

  it("does not render healthy or fake-derived statuses for empty live sources", () => {
    const hubSource = readSource("src/components/rounding/AdminRoundingPageClient.tsx");
    const liveSource = readSource("src/app/(admin)/admin/rounding/live/page.tsx");
    const reportsSource = readSource("src/app/(admin)/admin/rounding/reports/page.tsx");

    expect(hubSource).toContain("summary.expectedCount > 0");
    expect(liveSource).toContain("describeLiveBoardEmptyState");
    expect(liveSource).toContain("LiveBoardEmptyNotice");
    expect(reportsSource).not.toContain("Select a broader window.");
    expect(reportsSource).toContain("No matching entries for this window");
    expect(reportsSource).not.toContain("No live rows returned");
  });
});
