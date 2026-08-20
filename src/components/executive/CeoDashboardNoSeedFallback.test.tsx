import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

/**
 * The executive role dashboards (CEO / CFO / COO) must render only live data —
 * no seeded/mock rows, and no moonshot-theme chrome (which renders invisible
 * on the light app theme). These guards are source-string checks so they can't
 * regress silently. The tab bodies now compose the shared officer-dashboard
 * module (real KPI tiles + lanes + exec_alerts watchlist + honest empty states).
 */
describe("executive role dashboards — no seeded fallback", () => {
  it("CEO page client has no fake metric/alert fallbacks or moonshot chrome", () => {
    const source = readSource("src/components/executive/CeoDashboardPageClient.tsx");
    for (const forbidden of [
      "DEMO_ALERTS",
      "useClientDemoMode",
      '"91.8%"',
      '"1.2x"',
      '"342"',
      '"+18"',
      "generateMockGrowthFunnelData",
      "generateMockRiskIndexData",
      "FACILITY_SCORECARD",
      "MetricCardMoonshot",
      "KineticGrid",
      "showSparkline={Boolean(kpis)}",
      "sparklineVariant=",
    ]) {
      expect(source, `CeoDashboardPageClient still contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("CFO page has no seeded finance datasets or moonshot chrome", () => {
    const source = readSource("src/app/(admin)/executive/cfo/page.tsx");
    for (const forbidden of [
      "WATERFALL_DATA",
      "REVENUE_BY_FACILITY",
      "AR_AGING",
      "LABOR_TREND",
      "CASH_TREND",
      "CAPEX_ITEMS",
      "DEBT_SCHEDULE",
      "VARIANCE_DATA",
      "Riverside Manor",
      "Cedar Park",
      "$57.6M",
      "MetricCardMoonshot",
      "showSparkline={Boolean(kpis)}",
      "sparklineVariant=",
    ]) {
      expect(source, `cfo page still contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("COO page has no seeded operations datasets or moonshot chrome", () => {
    const source = readSource("src/app/(admin)/executive/coo/page.tsx");
    for (const forbidden of [
      "FAC_SHORT",
      "const ALERTS",
      "SHIFT_DATA",
      "COMPLAINTS",
      "AGENCY_DATA",
      "INCIDENT_DATA",
      "WORK_ORDERS",
      "MAINT_METRICS",
      "DIETARY_METRICS",
      "SATISFACTION_DATA",
      "TempForce",
      "Margaret W.",
      "MetricCardMoonshot",
      "showSparkline={Boolean(kpis)}",
      "sparklineVariant=",
    ]) {
      expect(source, `coo page still contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shared officer-dashboard module carries no seeded facility data", () => {
    const source = readSource("src/components/executive/officer-dashboard.tsx");
    for (const forbidden of ["Oakridge", "Plantation", "Cedar Park", "TempForce", "MetricCardMoonshot", "wiring in progress"]) {
      expect(source, `officer-dashboard still contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});
