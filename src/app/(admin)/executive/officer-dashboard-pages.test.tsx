import React from "react";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";

import CfoDashboardPage from "./cfo/page";
import CooDashboardPage from "./coo/page";
import { EXEC_KPI_METRICS_VERSION, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const refetchMock = vi.fn();

const zeroKpis: ExecKpiPayload = {
  version: EXEC_KPI_METRICS_VERSION,
  census: { occupiedResidents: 0, licensedBeds: 100, occupancyPct: 0 },
  financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
  clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
  compliance: { openSurveyDeficiencies: 0 },
  workforce: { certificationsExpiring30d: 0 },
  infection: { activeOutbreaks: 0 },
  residentAssurance: {
    overdueTasksCount: 0,
    missedRate: 0,
    openExceptions: 0,
    activeWatchCount: 0,
  },
};

let mockSelectedFacilityId: string | null = null;
let mockKpis: ExecKpiPayload = zeroKpis;

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mockSelectedFacilityId }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: "org-anon-1",
    loading: false,
  }),
}));

vi.mock("@/hooks/useExecRoleKpis", () => ({
  useExecRoleKpis: () => ({
    kpis: mockKpis,
    alerts: [],
    facilities: mockSelectedFacilityId
      ? [{ id: mockSelectedFacilityId, name: "Site Alpha", total_licensed_beds: 52 }]
      : [],
    loading: false,
    error: null,
    isDemo: false,
    refetch: refetchMock,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/executive/cfo",
}));

const STUB_MARKERS = ["wiring in progress", "coming soon", "Module "];

const CFO_STUB_TABS = [
  "Revenue Cycle",
  "Labor Economics",
  "Cash & Liquidity",
  "Capex & Debt",
  "Budget Variance",
];

const COO_STUB_TABS = ["Staffing", "Maintenance", "Dining", "Satisfaction", "Move Ops", "Vendors", "Readiness"];

function expectNoStubCopy(container: HTMLElement) {
  for (const marker of STUB_MARKERS) {
    expect(within(container).queryByText(new RegExp(marker, "i"))).not.toBeInTheDocument();
  }
}

describe("officer dashboard pages — training-week click paths", () => {
  beforeEach(() => {
    mockSelectedFacilityId = null;
    mockKpis = zeroKpis;
  });

  it("removes stub copy from officer-dashboard and role page sources", () => {
    for (const sourcePath of [
      "src/components/executive/officer-dashboard.tsx",
      "src/app/(admin)/executive/cfo/page.tsx",
      "src/app/(admin)/executive/coo/page.tsx",
    ]) {
      const source = readSource(sourcePath);
      for (const marker of STUB_MARKERS) {
        expect(source, `${sourcePath} still contains ${marker}`).not.toMatch(new RegExp(marker, "i"));
      }
      expect(source, `${sourcePath} still references OfficerEmptyTab`).not.toContain("OfficerEmptyTab");
    }
  });

  it("CFO board uses the shared executive strip instead of its own pills and never renders stub panes (COL-655)", () => {
    const { container } = render(<CfoDashboardPage />);

    expect(screen.getAllByRole("navigation", { name: "Executive intelligence sections" }).length).toBeGreaterThan(0);
    for (const tab of [...CFO_STUB_TABS, "Overview", "Scenarios", "Haven Insight"]) {
      expect(screen.queryByRole("button", { name: tab })).not.toBeInTheDocument();
    }
    expectNoStubCopy(container);
    expect(screen.getByText("Jump into the live finance queues.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scenarios/ })).toHaveAttribute("href", "/admin/executive/scenarios");
  });

  it("CFO occupancy tile labels portfolio scope when no facility is selected", () => {
    mockSelectedFacilityId = null;
    mockKpis = {
      ...zeroKpis,
      census: { occupiedResidents: 33, licensedBeds: 258, occupancyPct: 12.8 },
    };

    render(<CfoDashboardPage />);

    expect(screen.getByText("Portfolio occupancy")).toBeInTheDocument();
    expect(screen.getByText("12.8%")).toBeInTheDocument();
    expect(screen.queryByText("This facility occupancy")).not.toBeInTheDocument();
  });

  it("CFO occupancy tile labels this-facility scope when header selects a facility", () => {
    mockSelectedFacilityId = "00000000-0000-4000-8000-000000000001";
    mockKpis = {
      ...zeroKpis,
      census: { occupiedResidents: 48, licensedBeds: 52, occupancyPct: 91.7 },
    };

    render(<CfoDashboardPage />);

    expect(screen.getByText("This facility occupancy")).toBeInTheDocument();
    expect(screen.getByText("91.7%")).toBeInTheDocument();
    expect(screen.queryByText("Portfolio occupancy")).not.toBeInTheDocument();
  });

  it("COO board uses the shared executive strip instead of its own pills and never renders stub panes (COL-655)", () => {
    const { container } = render(<CooDashboardPage />);

    expect(screen.getAllByRole("navigation", { name: "Executive intelligence sections" }).length).toBeGreaterThan(0);
    for (const tab of [...COO_STUB_TABS, "Operations Hub", "Haven Insight"]) {
      expect(screen.queryByRole("button", { name: tab })).not.toBeInTheDocument();
    }
    expectNoStubCopy(container);
    expect(screen.getByText("Jump into the live operating queues.")).toBeInTheDocument();
  });
});
