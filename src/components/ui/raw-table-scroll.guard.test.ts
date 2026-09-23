import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Raw <table> markup outside the Table primitive (COL-657 guard). A wide table
 * in a plain overflow box gives a phone no sign that more columns exist and no
 * keyboard way to reach them; `HorizontalScroll` (or the Table primitive,
 * which uses it) does both. Files still to convert are listed below — the list
 * only shrinks.
 */

// Print sheets and PDF/HTML builders render to paper, not a phone viewport.
const PRINT_OUTPUTS = new Set<string>([
  "src/app/(print)/print/survey-pack/SurveyPackSheet.tsx",
  "src/components/care-events/print/IncidentFormSheet.tsx",
  "src/components/care-events/print/IncidentReportsLogSheet.tsx",
  "src/components/care-events/print/TaxonomyPacketSheet.tsx",
  "src/lib/executive/league-print.ts",
  "src/lib/executive/standup-pdf.ts",
  "src/lib/office/morning-huddle-print.ts",
  "src/lib/reports/metric-presentation.ts",
  "src/lib/risk/survey-bundle-print.ts",
]);

// Screen tables not yet on HorizontalScroll (COL-657 follow-up).
const NOT_YET_CONVERTED = new Set<string>([
  "src/app/(admin)/admin/activities/page.tsx",
  "src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx",
  "src/app/(admin)/admin/drive-import/[id]/page.tsx",
  "src/app/(admin)/admin/knowledge/coverage/page.tsx",
  "src/app/(admin)/admin/residents/[id]/assessments/new/page.tsx",
  "src/app/(admin)/admin/rounding/watchlist/[residentId]/page.tsx",
  "src/app/(admin)/admin/v2/settings/audit-log/page.tsx",
  "src/app/(admin)/executive/reports/page.tsx",
  "src/app/(admin)/executive/scenarios/page.tsx",
  "src/app/(admin)/executive/standup/[week]/board/page.tsx",
  "src/app/(admin)/executive/standup/[week]/page.tsx",
  "src/app/(admin)/executive/standup/compare/page.tsx",
  "src/app/(admin)/executive/standup/page.tsx",
  "src/app/(admin)/finance/trust/page.tsx",
  "src/app/(admin)/insurance/claims/[id]/page.tsx",
  "src/app/(admin)/insurance/loss-runs/page.tsx",
  "src/app/(admin)/insurance/policies/[id]/page.tsx",
  "src/app/(admin)/insurance/workers-comp/page.tsx",
  "src/app/(admin)/training/page.tsx",
  "src/app/(admin)/vendors/directory/page.tsx",
  "src/app/(admin)/vendors/invoices/[id]/page.tsx",
  "src/app/(admin)/vendors/payments/page.tsx",
  "src/app/(admin)/vendors/purchase-orders/[id]/page.tsx",
  "src/app/(admin)/vendors/purchase-orders/page.tsx",
  "src/app/(admin)/vendors/spend/page.tsx",
  "src/components/admin/facilities/tabs/AuditTab.tsx",
  "src/components/admin/facilities/tabs/DocumentsTab.tsx",
  "src/components/admin/facilities/tabs/OverviewTab.tsx",
  "src/components/admin/facilities/tabs/StaffingTab.tsx",
  "src/components/admin/facilities/tabs/ThresholdsTab.tsx",
  "src/components/admin/facilities/tabs/TimeclockTab.tsx",
  "src/components/admin/facilities/tabs/VendorsTab.tsx",
  "src/components/admin/settings/SearchToolDashboard.tsx",
  "src/components/facility-checks/BoardCheckClient.tsx",
  "src/components/facility-checks/StaffCheckClient.tsx",
  "src/components/finance/FinanceForecastPageClient.tsx",
  "src/components/registers/VisitorLogClient.tsx",
  "src/components/risk/RiskCommandPageClient.tsx",
  "src/components/risk/RiskSurveyBundlePageClient.tsx",
  "src/components/rounding/CadenceLadderList.tsx",
  "src/components/rounding/CadenceTemplatePortfolio.tsx",
  "src/components/rounding/MonitoringOrdersTable.tsx",
  "src/components/rounding/ObservationReportBreakdown.tsx",
  "src/components/rounding/WatchlistDispositionLedger.tsx",
  "src/components/rounding/WatchlistFacilityTable.tsx",
  "src/components/rounding/WatchlistPortfolioTable.tsx",
  "src/components/stand-up/out-of-house.tsx",
  "src/components/timeclock/StaffTimesheet.tsx",
  "src/components/timeclock/TimeclockOverview.tsx",
  "src/components/timeclock/UpunchCompare.tsx",
  "src/components/v2/settings/ThresholdsEditor.tsx",
  "src/design-system/components/DataTable/DataTable.tsx",
  "src/features/knowledge/components/DocumentTable.tsx",
]);

const hasScrollAffordance = (source: string) =>
  source.includes("<HorizontalScroll") || (source.includes('role="region"') && source.includes("tabIndex={0}"));

describe("raw tables scroll with an affordance (COL-657 guard)", () => {
  const files = execFileSync("git", ["grep", "-l", "<table", "--", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !/\.test\.tsx?$/.test(file) && file !== "src/components/ui/table.tsx");

  it.each(files.filter((file) => !PRINT_OUTPUTS.has(file) && !NOT_YET_CONVERTED.has(file)))(
    "%s wraps its table in HorizontalScroll",
    (file) => {
      expect(hasScrollAffordance(readFileSync(file, "utf8"))).toBe(true);
    },
  );

  it("drops converted files from the pending list", () => {
    for (const file of NOT_YET_CONVERTED) {
      expect(files, `${file} no longer has a raw table`).toContain(file);
      expect(hasScrollAffordance(readFileSync(file, "utf8")), `${file} is converted — remove it from NOT_YET_CONVERTED`).toBe(false);
    }
  });
});
