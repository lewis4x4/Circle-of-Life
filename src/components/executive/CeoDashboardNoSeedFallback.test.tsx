import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import CeoDashboardTabs from "@/components/executive/ceo/CeoDashboardTabs";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

afterEach(() => cleanup());

describe("CEO dashboard seeded fallback removal", () => {
  it("does not keep fake CEO metric or alert fallbacks in the page client", () => {
    const source = readSource("src/components/executive/CeoDashboardPageClient.tsx");

    expect(source).not.toContain("DEMO_ALERTS");
    expect(source).not.toContain("useClientDemoMode");
    expect(source).not.toContain('"91.8%"');
    expect(source).not.toContain('"1.2x"');
    expect(source).not.toContain('"342"');
    expect(source).not.toContain('"+18"');
    expect(source).not.toContain("showSparkline={Boolean(kpis)}");
    expect(source).not.toContain("sparklineVariant=");
  });

  it("does not import or generate mock CEO tab datasets", () => {
    const source = readSource("src/components/executive/ceo/CeoDashboardTabs.tsx");

    expect(source).not.toContain("generateMockGrowthFunnelData");
    expect(source).not.toContain("generateMockRiskIndexData");
    expect(source).not.toContain("OCCUPANCY_TREND");
    expect(source).not.toContain("FACILITY_SCORECARD");
    expect(source).not.toContain("BENCHMARKS");
    expect(source).not.toContain("Oakridge");
    expect(source).not.toContain("Rising Oaks");
    expect(source).not.toContain("Grande Cypress");
  });

  it("renders an explicit empty alert state instead of seeded alerts", () => {
    render(<CeoDashboardTabs tab="Alerts" displayAlerts={[]} />);

    expect(screen.getByText("No live CEO alerts")).toBeInTheDocument();
    expect(screen.queryByText(/Oakridge|Cedar Park|Homewood|Grande Cypress/i)).not.toBeInTheDocument();
  });

  it("renders an explicit empty CEO detail state instead of mock charts", () => {
    render(<CeoDashboardTabs tab="CEO View" displayAlerts={[]} />);

    expect(screen.getByText("Live CEO detail source is not loaded")).toBeInTheDocument();
    expect(screen.getByText(/No fallback chart data is shown/i)).toBeInTheDocument();
    expect(screen.queryByText("Growth & Acumen Funnel")).not.toBeInTheDocument();
    expect(screen.queryByText("Legal & Reputation Risk Index")).not.toBeInTheDocument();
  });

  it("does not keep seeded CFO role datasets", () => {
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
      "SCENARIOS",
      "Riverside Manor",
      "Cedar Park",
      "$57.6M",
      "28.4",
      "+112%",
      "showSparkline={Boolean(kpis)}",
      "sparklineVariant=",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("does not keep seeded COO role datasets", () => {
    const source = readSource("src/app/(admin)/executive/coo/page.tsx");

    for (const forbidden of [
      "FAC_SHORT",
      "const ALERTS",
      "TRANSPORT",
      "SHIFT_DATA",
      "COMPLAINTS",
      "AGENCY_DATA",
      "INCIDENT_DATA",
      "WORK_ORDERS",
      "MAINT_METRICS",
      "DIETARY_METRICS",
      "SATISFACTION_DATA",
      "MOVE_OPS",
      "VENDORS",
      "EMERGENCY_DATA",
      "HOUSEKEEPING",
      "Oakridge",
      "Plantation",
      "TempForce",
      "Margaret W.",
      "58",
      "93.4%",
      "showSparkline={Boolean(kpis)}",
      "sparklineVariant=",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
