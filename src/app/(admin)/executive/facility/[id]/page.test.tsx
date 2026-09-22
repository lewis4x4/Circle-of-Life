import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveFacilityDetailPage from "@/app/(admin)/executive/facility/[id]/page";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_FACILITY_ID = "33333333-3333-4333-8333-333333333333";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const routeMock = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111",
  push: vi.fn(),
}));

const fetchExecutiveKpiSnapshotMock = vi.hoisted(() => vi.fn());
const computeTotalCostOfRiskMock = vi.hoisted(() => vi.fn());
const fetchHeatMapMock = vi.hoisted(() => vi.fn());
const fetchTrendMock = vi.hoisted(() => vi.fn());
const fetchFacilityComplianceMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: routeMock.id }),
  useRouter: () => ({ push: routeMock.push, refresh: vi.fn() }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: (table: string) => {
      if (table === "facilities") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: FACILITY_ID,
                    name: "Anon Facility",
                    entity_id: ENTITY_ID,
                    organization_id: "org-anon-1",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "entities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: "Anon Entity" }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/exec-kpi-snapshot", () => ({
  fetchExecutiveKpiSnapshot: fetchExecutiveKpiSnapshotMock,
}));

vi.mock("@/lib/insurance/compute-tcor", () => ({
  computeTotalCostOfRisk: computeTotalCostOfRiskMock,
}));

vi.mock("@/lib/resident-assurance/command-center-brief", () => ({
  fetchResidentAssuranceFacilityHeatMap: fetchHeatMapMock,
  fetchResidentAssuranceFacilityTrendSeries: fetchTrendMock,
}));

vi.mock("@/lib/executive/facility-rounding-compliance", () => ({
  fetchExecutiveFacilityCompliance: fetchFacilityComplianceMock,
}));

vi.mock("../../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

function kpiPayload(overrides: Partial<ExecKpiPayload> = {}): ExecKpiPayload {
  return {
    version: 1,
    census: {
      occupiedResidents: 0,
      licensedBeds: 52,
      occupancyPct: null,
      presence: { inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 },
    },
    financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
    clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
    compliance: { openSurveyDeficiencies: 0 },
    workforce: { certificationsExpiring30d: 0 },
    infection: { activeOutbreaks: 0 },
    residentAssurance: { overdueTasksCount: 0, missedRate: null, openExceptions: 0, activeWatchCount: 0 },
    ...overrides,
  };
}

function rollup(overrides: Record<string, unknown> = {}) {
  return {
    facilityId: FACILITY_ID,
    facilityName: "Anon Facility",
    activeWatches: 0,
    pendingWatchApprovals: 0,
    openEscalations: 0,
    openIntegrityFlags: 0,
    criticalSafetyResidents: 0,
    highOrCriticalSafetyResidents: 0,
    heatScore: 0,
    heatBand: "stable",
    observed: false,
    lastObservedAt: null,
    ...overrides,
  };
}

function trendRow(observedDays: number) {
  const dates = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"];
  const points = dates.map((date, index) => ({
    date,
    watchStarts: 0,
    escalations: index === 6 && observedDays > 0 ? 1 : 0,
    integrityFlags: 0,
    criticalResidents: 0,
    heatScore: index === 6 && observedDays > 0 ? 3 : 0,
    heatBand: index === 6 && observedDays > 0 ? "watch" : "stable",
    observed: index >= dates.length - observedDays,
  }));
  return {
    facilityId: FACILITY_ID,
    facilityName: "Anon Facility",
    latestHeatScore: 0,
    peakHeatScore: 0,
    avgHeatScore: 0,
    points,
    observedDays,
    days: 7,
    lastObservedDate: observedDays > 0 ? "2026-09-15" : null,
  };
}

function tcorSnapshot(overrides: Record<string, number> = {}) {
  return {
    periodStart: "2025-09-15",
    periodEnd: "2026-09-15",
    premiumsCents: 0,
    incurredLossesCents: 0,
    tcorCents: 0,
    policyRows: 0,
    claimRows: 0,
    ...overrides,
  };
}

function complianceSummary(
  overrides: Partial<{
    expected: number;
    satisfied: number;
    unconfigured: number;
    absorbed: number;
    withTask: number;
    onTime: number;
    late: number;
  }> = {},
) {
  return {
    from: "2026-09-08",
    to: "2026-09-14",
    totals: {
      expected: 12,
      satisfied: 9,
      unconfigured: 0,
      absorbed: 0,
      withTask: 12,
      onTime: 9,
      late: 0,
      ...overrides,
    },
    byShift: [],
    byHall: [],
    byStaff: [],
  };
}

function resetStore(selectedFacilityId: string | null) {
  useFacilityStore.setState({
    selectedFacilityId,
    selectedReportingPeriod: null,
    availableFacilities: [
      { id: FACILITY_ID, name: "Anon Facility" },
      { id: OTHER_FACILITY_ID, name: "Other Facility" },
    ],
    facilitiesFetchedAt: Date.now(),
    facilitiesCacheUserId: "user-1",
  });
}

beforeEach(() => {
  routeMock.id = FACILITY_ID;
  routeMock.push.mockReset();
  fetchExecutiveKpiSnapshotMock.mockReset();
  fetchExecutiveKpiSnapshotMock.mockResolvedValue(kpiPayload());
  computeTotalCostOfRiskMock.mockReset();
  computeTotalCostOfRiskMock.mockResolvedValue({ ok: true, snapshot: tcorSnapshot() });
  fetchHeatMapMock.mockReset();
  fetchHeatMapMock.mockResolvedValue([rollup()]);
  fetchTrendMock.mockReset();
  fetchTrendMock.mockResolvedValue([trendRow(0)]);
  fetchFacilityComplianceMock.mockReset();
  fetchFacilityComplianceMock.mockResolvedValue(complianceSummary());
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
  resetStore(OTHER_FACILITY_ID);
  document.cookie = "haven_selected_facility=; Max-Age=0; Path=/";
});

describe("ExecutiveFacilityDetailPage auth hydration", () => {
  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveFacilityDetailPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveFacilityDetailPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
  });
});

describe("ExecutiveFacilityDetailPage header and context", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
  });

  it("names the facility once in the breadcrumb and heading, with its legal entity", async () => {
    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Anon Facility" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Executive overview/Anon Facility");
    expect(screen.getByText("Facility overview")).toBeInTheDocument();
    // Entity details resolve in a separate request after the facility heading.
    expect(await screen.findByRole("link", { name: /Anon Entity/ })).toHaveAttribute("href", `/admin/executive/entity/${ENTITY_ID}`);
    expect(screen.queryByText(/same engine as the executive overview/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scoped facility/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Source modules/)).not.toBeInTheDocument();
  });

  it("aligns the global facility selector to the facility in the route", async () => {
    render(<ExecutiveFacilityDetailPage />);

    await screen.findByRole("heading", { level: 1, name: "Anon Facility" });
    await waitFor(() => expect(useFacilityStore.getState().selectedFacilityId).toBe(FACILITY_ID));
    expect(document.cookie).toContain(`haven_selected_facility=${FACILITY_ID}`);
    expect(screen.queryByText(/is being held on/)).not.toBeInTheDocument();
  });

  it("follows the selector to another facility once the operator moves it", async () => {
    render(<ExecutiveFacilityDetailPage />);

    await screen.findByRole("heading", { level: 1, name: "Anon Facility" });
    await waitFor(() => expect(useFacilityStore.getState().selectedFacilityId).toBe(FACILITY_ID));

    act(() => {
      useFacilityStore.getState().setSelectedFacility(OTHER_FACILITY_ID);
    });

    await waitFor(() => expect(routeMock.push).toHaveBeenCalledWith(`/admin/executive/facility/${OTHER_FACILITY_ID}`));
  });

  it("returns to the portfolio when the operator chooses all facilities", async () => {
    render(<ExecutiveFacilityDetailPage />);

    await screen.findByRole("heading", { level: 1, name: "Anon Facility" });
    await waitFor(() => expect(useFacilityStore.getState().selectedFacilityId).toBe(FACILITY_ID));

    act(() => {
      useFacilityStore.getState().setSelectedFacility(null);
    });

    await waitFor(() => expect(routeMock.push).toHaveBeenCalledWith("/admin/executive"));
  });

  it("says so when a form guard holds the selector on another facility", async () => {
    const release = useFacilityStore.getState().registerFacilityChangeGuard(() => false);
    try {
      render(<ExecutiveFacilityDetailPage />);

      expect(await screen.findByText(/is being held on Other Facility/)).toBeInTheDocument();
      expect(useFacilityStore.getState().selectedFacilityId).toBe(OTHER_FACILITY_ID);
    } finally {
      release();
    }
  });

  it("shows the read time and refreshes on demand", async () => {
    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText(/^Updated /)).toBeInTheDocument();
    expect(fetchExecutiveKpiSnapshotMock).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByRole("button", { name: /Refresh/ }).click();
    });

    await waitFor(() => expect(fetchExecutiveKpiSnapshotMock).toHaveBeenCalledTimes(2));
  });
});

describe("ExecutiveFacilityDetailPage attention and snapshot states", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
  });

  it("keeps an unposted census apart from a counted-empty roster", async () => {
    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("Not posted")).toBeInTheDocument();
    expect(screen.getByText("52 licensed beds · no bed census on file")).toBeInTheDocument();
    expect(screen.getByText("No residents on the roster")).toBeInTheDocument();
    expect(screen.getByText("Census not posted")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: /Review census/ })) {
      expect(link).toHaveAttribute("href", `/admin/facilities/${FACILITY_ID}`);
    }
    expect(screen.queryByText(/0 beds occupied/)).not.toBeInTheDocument();
  });

  it("shows a posted census as beds and occupancy", async () => {
    fetchExecutiveKpiSnapshotMock.mockResolvedValue(
      kpiPayload({
        census: {
          occupiedResidents: 12,
          licensedBeds: 52,
          occupancyPct: 23.1,
          presence: { inHouse: 11, hospital: 1, onLeave: 0, onHold: 1, total: 12 },
        },
      }),
    );

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("12 beds occupied")).toBeInTheDocument();
    expect(screen.getByText("23% of the posted bed grid · 52 licensed")).toBeInTheDocument();
    expect(screen.getByText("11 in-house")).toBeInTheDocument();
    expect(screen.getByText("1 hospital · 0 on leave · 12 on the roster")).toBeInTheDocument();
    expect(screen.queryByText("Census not posted")).not.toBeInTheDocument();
  });

  it("elevates a recorded open incident without inventing severity", async () => {
    fetchExecutiveKpiSnapshotMock.mockResolvedValue(kpiPayload({ clinical: { openIncidents: 1, medicationErrorsMtd: 0 } }));

    render(<ExecutiveFacilityDetailPage />);

    const attention = (await screen.findByRole("heading", { name: "Needs attention" })).closest("section");
    expect(attention).not.toBeNull();
    expect(attention).toHaveTextContent("1 open incident");
    expect(attention).toHaveTextContent("Open the record for severity, owner, and next action.");
    expect(screen.getByRole("link", { name: /^View incident$/ })).toHaveAttribute("href", "/admin/incidents?scope=open");
    expect(screen.queryByText(/severity: /i)).not.toBeInTheDocument();
  });

  it("lists a check the building recorded as did not run, escalated to this executive (COL-602)", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { instanceId: "i-1", facilityId: FACILITY_ID, facilityName: "Anon Facility", title: "Generator weekly run", assignedShiftDate: "2026-09-22", status: "completed", reason: "did_not_run", note: "Outcome: did not run. Stuck.", owner: { kind: "queue" }, href: "/admin/operations/work" },
        { instanceId: "i-2", facilityId: OTHER_FACILITY_ID, facilityName: "Other", title: "Generator weekly run", assignedShiftDate: "2026-09-22", status: "completed", reason: "did_not_run", owner: { kind: "queue" }, href: "/admin/operations/work" },
      ],
      error: null,
    });

    render(<ExecutiveFacilityDetailPage />);

    const attention = (await screen.findByRole("heading", { name: "Needs attention" })).closest("section");
    await waitFor(() => expect(attention).toHaveTextContent("1 check recorded as did not run"));
    expect(rpcMock).toHaveBeenCalledWith("home_escalations_for_executive");
  });

  it("does not claim an all-clear while measures are unrecorded", async () => {
    render(<ExecutiveFacilityDetailPage />);

    expect(
      await screen.findByText(/No open items recorded\. 3 measures are not recorded, so this is not an all-clear\./),
    ).toBeInTheDocument();
  });

  it("gives a plain all-clear only when everything is recorded and empty", async () => {
    fetchExecutiveKpiSnapshotMock.mockResolvedValue(
      kpiPayload({
        census: { occupiedResidents: 0, licensedBeds: 52, occupancyPct: 0, presence: { inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 } },
      }),
    );
    fetchHeatMapMock.mockResolvedValue([rollup({ observed: true, lastObservedAt: "2026-09-15T10:00:00Z" })]);
    fetchTrendMock.mockResolvedValue([trendRow(7)]);
    computeTotalCostOfRiskMock.mockResolvedValue({ ok: true, snapshot: tcorSnapshot({ policyRows: 1, premiumsCents: 120000, tcorCents: 120000 }) });

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("No open items recorded for this facility.")).toBeInTheDocument();
    expect(screen.queryByText("Not yet recorded")).not.toBeInTheDocument();
  });
});

describe("ExecutiveFacilityDetailPage rounding", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
  });

  it("does not render an unobserved facility as stable", async () => {
    render(<ExecutiveFacilityDetailPage />);

    const roundingSection = (await screen.findByRole("heading", { name: "Rounding assurance" })).closest("section");
    expect(roundingSection).toHaveTextContent("Not observed");
    expect(roundingSection).toHaveTextContent("Nothing recorded yet");
    expect(roundingSection).toHaveTextContent("0 of 7 days recorded");
    expect(roundingSection).toHaveTextContent("absences of records, not results");
    const days = screen.getByRole("list", { name: "Rounding band by day" });
    expect(days).not.toHaveTextContent("Low");
    expect(days.querySelectorAll("li")).toHaveLength(7);
    expect(screen.getByText("No rounding observations recorded")).toBeInTheDocument();
    expect(screen.getByText(/Finding bands are separate from completion compliance/)).toBeInTheDocument();
  });

  it("shows bands only on days something was recorded, with the band rule spelled out", async () => {
    fetchHeatMapMock.mockResolvedValue([rollup({ observed: true, openEscalations: 1, heatScore: 3, heatBand: "watch", lastObservedAt: "2026-09-15T10:00:00Z" })]);
    fetchTrendMock.mockResolvedValue([trendRow(2)]);

    render(<ExecutiveFacilityDetailPage />);

    const days = await screen.findByRole("list", { name: "Rounding band by day" });
    const items = days.querySelectorAll("li");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("Sep 9");
    expect(items[0]).toHaveTextContent("—");
    expect(items[0]).toHaveTextContent("Not recorded");
    expect(items[5]).toHaveTextContent("Low");
    expect(items[6]).toHaveTextContent("Watch");
    expect(items[6]).toHaveTextContent("1 escalation");
    expect(screen.getByText(/a watch start counts 1, an integrity flag 2, an escalation 3/)).toBeInTheDocument();
    expect(screen.getByText("2 of 7 days recorded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^1 open escalations$/ })).toHaveAttribute("href", "/admin/rounding?filter=escalated");
  });

  it("shows seven-day completed, missed and configuration-gap counts from historical compliance", async () => {
    fetchFacilityComplianceMock.mockResolvedValue(
      complianceSummary({ expected: 12, satisfied: 9, unconfigured: 2 }),
    );

    render(<ExecutiveFacilityDetailPage />);

    const compliance = await screen.findByRole("region", { name: "Seven-day rounding compliance" });
    expect(compliance).toHaveTextContent("Sep 8–14, 2026 · America/New_York");
    expect(compliance).toHaveTextContent("Completed9");
    expect(compliance).toHaveTextContent("Missed3");
    expect(compliance).toHaveTextContent("Configuration gaps2");
    expect(compliance).toHaveTextContent("75% of 12 expected windows completed");
  });

  it("names a successful empty compliance read without rendering favorable zeroes", async () => {
    fetchFacilityComplianceMock.mockResolvedValue(
      complianceSummary({ expected: 0, satisfied: 0, unconfigured: 0, withTask: 0, onTime: 0 }),
    );

    render(<ExecutiveFacilityDetailPage />);

    const compliance = await screen.findByRole("region", { name: "Seven-day rounding compliance" });
    expect(compliance).toHaveTextContent("No compliance expectations returned for this range");
    expect(compliance).not.toHaveTextContent("Completed0");
    expect(compliance).not.toHaveTextContent("Missed0");
  });

  it("names a cadence gap without presenting it as zero completed or zero missed", async () => {
    fetchFacilityComplianceMock.mockResolvedValue(
      complianceSummary({ expected: 0, satisfied: 0, unconfigured: 4, withTask: 0, onTime: 0 }),
    );

    render(<ExecutiveFacilityDetailPage />);

    const compliance = await screen.findByRole("region", { name: "Seven-day rounding compliance" });
    expect(compliance).toHaveTextContent("Configuration gap");
    expect(compliance).toHaveTextContent("4 expected windows had no cadence in force");
    expect(compliance).not.toHaveTextContent("Completed0");
    expect(compliance).not.toHaveTextContent("Missed0");
  });

  it("keeps recorded findings visible when historical compliance fails", async () => {
    fetchHeatMapMock.mockResolvedValue([
      rollup({ observed: true, heatScore: 3, heatBand: "watch", lastObservedAt: "2026-09-15T10:00:00Z" }),
    ]);
    fetchTrendMock.mockResolvedValue([trendRow(2)]);
    fetchFacilityComplianceMock.mockRejectedValue(new Error("Historical compliance unavailable."));

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("Historical compliance unavailable.")).toBeInTheDocument();
    const roundingSection = screen.getByRole("heading", { name: "Rounding assurance" }).closest("section");
    expect(roundingSection).toHaveTextContent("Current bandWatch");
    expect(roundingSection).toHaveTextContent("2 of 7 days recorded");
  });

  it("shows a named compliance loading state without favorable placeholder counts", async () => {
    fetchFacilityComplianceMock.mockReturnValue(new Promise(() => undefined));

    render(<ExecutiveFacilityDetailPage />);

    const compliance = await screen.findByRole("region", { name: "Seven-day rounding compliance" });
    expect(compliance).toHaveTextContent("Loading seven-day compliance…");
    expect(compliance).not.toHaveTextContent("Completed0");
    expect(compliance).not.toHaveTextContent("Missed0");
  });

  it("keeps historical compliance visible when the findings read fails", async () => {
    fetchHeatMapMock.mockRejectedValue(new Error("Rounding findings unavailable."));

    render(<ExecutiveFacilityDetailPage />);

    expect((await screen.findAllByText("Rounding findings unavailable.")).length).toBeGreaterThan(0);
    const compliance = screen.getByRole("region", { name: "Seven-day rounding compliance" });
    expect(compliance).toHaveTextContent("Completed9");
    expect(compliance).toHaveTextContent("Missed3");
  });
});

describe("ExecutiveFacilityDetailPage entity insurance", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
  });

  it("names an empty period as nothing on file rather than a zero cost", async () => {
    render(<ExecutiveFacilityDetailPage />);

    const section = (await screen.findByRole("heading", { name: "Entity insurance costs" })).closest("section");
    expect(section).toHaveTextContent("Anon Entity");
    expect(section).toHaveTextContent("Sep 15, 2025 – Sep 15, 2026 · rolling 12 months");
    expect(section).toHaveTextContent("No policies or claims on file for this period");
    expect(section).not.toHaveTextContent("$0.00");
    expect(section).toHaveTextContent("Figures belong to the legal entity. They are not allocated to this facility.");
  });

  it("shows a recorded total with its components and entity scope", async () => {
    computeTotalCostOfRiskMock.mockResolvedValue({
      ok: true,
      snapshot: tcorSnapshot({ premiumsCents: 1250000, incurredLossesCents: 40000, tcorCents: 1290000, policyRows: 2, claimRows: 1 }),
    });

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("$12,900.00")).toBeInTheDocument();
    expect(screen.getByText("Total cost of risk")).toBeInTheDocument();
    expect(
      screen.getByText("$12,500.00 premiums across 2 policies · $400.00 incurred losses (paid plus reserves) across 1 claim"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/TCoR/)).not.toBeInTheDocument();
  });
});

describe("ExecutiveFacilityDetailPage partial failures", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
  });

  it("keeps rounding and insurance on screen when the facility figures fail", async () => {
    fetchExecutiveKpiSnapshotMock.mockRejectedValue(new Error("Unable to reach KPI snapshot."));

    render(<ExecutiveFacilityDetailPage />);

    expect((await screen.findAllByText("Unable to reach KPI snapshot.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Rounding assurance" })).toBeInTheDocument();
    expect(screen.getByText("No policies or claims on file for this period, so there is no cost to show.")).toBeInTheDocument();
    expect(screen.getByText(/Some figures could not be read, so this is not an all-clear/)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("keeps the facility figures when the rounding read fails", async () => {
    fetchHeatMapMock.mockRejectedValue(new Error("Rounding unavailable."));

    render(<ExecutiveFacilityDetailPage />);

    expect((await screen.findAllByText("Rounding unavailable.")).length).toBeGreaterThan(0);
    expect(screen.getByText("Not posted")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
  });

  it("names an insurance read failure inside its own section", async () => {
    computeTotalCostOfRiskMock.mockResolvedValue({ ok: false, error: "permission denied for insurance_policies" });

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("permission denied for insurance_policies")).toBeInTheDocument();
    expect(screen.getByText("Not posted")).toBeInTheDocument();
  });
});
