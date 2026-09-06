import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NO_FACILITY_SOURCE_NOTICE } from "@/lib/assessments/load-overdue-assessments";
import { adminIncidentsGlobalEmptyNotice } from "@/lib/incidents/incidents-board-copy";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const LIVE_ADMIN_SOURCES = [
  "src/components/residents/AdminResidentsPageClient.tsx",
  "src/components/incidents/AdminIncidentsPageClient.tsx",
  "src/app/(admin)/assessments/overdue/page.tsx",
  "src/components/assessments/AdminOverdueAssessmentsPageClient.tsx",
  "src/app/(admin)/residents/page.tsx",
  "src/app/(admin)/incidents/page.tsx",
];

const SEEDED_ADMIN_MARKERS = [
  "isDemoMode",
  "initialDemoFallback",
  "demoFallbackActive",
  "DEMO HYDRATION",
  "DEMO-2025",
  "Demo mode is active",
  "illustrative sample",
  "Margaret Sullivan",
  "Arthur Pendelton",
  "Eleanor Vance",
  "Robert Chen",
  "Lucille Booth",
  "Martha Jones",
  "James Holden",
  "Demo Nurse",
  "Demo Staff",
  "Demo RN",
  "Sparkline",
  "sparkline",
];

describe("admin live surfaces seeded fallback removal", () => {
  it("does not keep demo hydration branches or seeded rows in live admin entrypoints", () => {
    for (const sourcePath of LIVE_ADMIN_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of SEEDED_ADMIN_MARKERS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("keeps explicit empty live states instead of sample roster or incident rows", () => {
    const residentsSource = readSource("src/components/residents/AdminResidentsPageClient.tsx");
    const incidentsSource = readSource("src/components/incidents/AdminIncidentsPageClient.tsx");
    const clinicalDeskSource = readSource("src/app/(admin)/assessments/overdue/page.tsx");

    expect(residentsSource).toContain("Live resident roster returned no residents");
    expect(residentsSource).toContain("setRows(liveRows)");
    expect(residentsSource).toContain("!error && filteredRows.length > 0");
    expect(incidentsSource).toContain("setRows(liveRows)");
    expect(incidentsSource).toContain("{adminIncidentsGlobalEmptyNotice()}");
    expect(adminIncidentsGlobalEmptyNotice()).toBe("No live incident records for this scope. Fallback incident cards are not shown.");
    expect(clinicalDeskSource).toContain("<AdminOverdueAssessmentsPageClient");
    expect(clinicalDeskSource).toContain("initialSourceNotice={initialSourceNotice}");
    const clinicalDeskClient = readSource("src/components/assessments/AdminOverdueAssessmentsPageClient.tsx");
    expect(clinicalDeskClient).toContain("No overdue assessments.");
    expect(clinicalDeskClient).toContain("No drafts awaiting review.");
    expect(NO_FACILITY_SOURCE_NOTICE).toContain("No cross-facility fallback query is run.");
  });
});
