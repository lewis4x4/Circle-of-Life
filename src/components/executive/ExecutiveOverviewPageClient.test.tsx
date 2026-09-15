import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutiveOverviewPageClient, EXECUTIVE_OVERVIEW_LOADING_MESSAGE } from "./ExecutiveOverviewPageClient";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";

const authMock = vi.hoisted(() => ({
  loading: true,
  appRole: "",
  organizationId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  loadError: null as string | null,
}));

function buildSupabaseChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () =>
      Promise.resolve(
        supabaseMock.loadError
          ? { data: null, error: { message: supabaseMock.loadError } }
          : { data: [], error: null },
      ),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/executive",
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => buildSupabaseChain(),
  }),
}));

vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

const emptyProps = {
  initialMetrics: {},
  initialAlerts: [],
  initialFacilities: [],
  initialAssuranceHeatMap: [],
  initialAssuranceTrends: [],
  initialPresenceCensus: EMPTY_PRESENCE_CENSUS,
  initialOccupancyContext: null,
  initialSnapshot: { kind: "never_recorded" } as const,
  initialMetricChanges: {},
  initialHasServerData: false,
};

describe("ExecutiveOverviewPageClient organization gap handling", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = null;
    supabaseMock.loadError = null;
  });

  it("suppresses the legacy org crash string while auth hydrates", () => {
    authMock.loading = true;
    authMock.appRole = "owner";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(EXECUTIVE_OVERVIEW_LOADING_MESSAGE);
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(EXECUTIVE_OVERVIEW_LOADING_MESSAGE)).not.toBeInTheDocument();
  });

  it("does not show the org gap when server-scoped data is already on screen", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = null;

    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 50000 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialHasServerData
      />,
    );

    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.getByText("Portfolio figures")).toBeInTheDocument();
  });

  it("shows named loading instead of empty KPI gaps while auth hydrates", () => {
    authMock.loading = true;
    authMock.appRole = "owner";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(screen.getByRole("status")).toHaveTextContent(EXECUTIVE_OVERVIEW_LOADING_MESSAGE);
    expect(screen.queryByText("No census loaded yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Snapshot pending — run the executive refresh")).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-anon-1";
    supabaseMock.loadError = "Could not load executive overview.";

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(await screen.findByText("Could not load executive overview.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });
});

describe("ExecutiveOverviewPageClient role-home subtitle", () => {
  it("does not flash Loading role home on first paint while auth is loading", () => {
    authMock.loading = true;
    authMock.appRole = "facility_admin";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(screen.queryByText(/Loading role home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facility Admin home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Owner home/)).not.toBeInTheDocument();
  });

  it("holds the last resolved subtitle when auth reloads after hydration", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";

    const { rerender } = render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(
      screen.getByText(
        "Owner home — portfolio movement, exception pressure, leadership decisions only.",
      ),
    ).toBeInTheDocument();

    authMock.loading = true;
    authMock.appRole = "owner";
    rerender(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(
      screen.getByText(
        "Owner home — portfolio movement, exception pressure, leadership decisions only.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Loading role home/)).not.toBeInTheDocument();
  });

  it("shows the hydrated role home once auth resolves", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(
      screen.getByText(
        "Owner home — portfolio movement, exception pressure, leadership decisions only.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Loading role home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facility Admin home/)).not.toBeInTheDocument();
  });
});

describe("ExecutiveOverviewPageClient portfolio occupancy display", () => {
  it("renders posted zero occupancy as 0% in the portfolio table, not 0.0%", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";

    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ occ_pt: 0 }}
        initialFacilities={[
          {
            id: "homewood",
            name: "Homewood Lodge ALF",
            metrics: { occ_pt: 0 },
          },
        ]}
        initialHasServerData
      />,
    );

    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
});

describe("ExecutiveOverviewPageClient missing KPI gaps", () => {
  it("names missing KPI gaps in the strip instead of a silent em dash", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";

    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 125000 }}
        initialFacilities={[
          {
            id: "site-a",
            name: "Site Alpha",
            metrics: { rev_mtd: 125000 },
          },
        ]}
        initialHasServerData
      />,
    );

    expect(screen.getAllByText("No census loaded yet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("No payroll loaded this period").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("No incident rate yet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("No survey on file").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps numeric zero as 0% for posted occupancy in the KPI strip", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";

    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ occ_pt: 0 }}
        initialOccupancyContext={{
          occupiedResidents: 0,
          licensedBeds: 50,
          occupancyPct: 0,
          allFacilitiesPosted: true,
          postedFacilityCount: 1,
          totalFacilityCount: 1,
        }}
        initialFacilities={[
          {
            id: "site-a",
            name: "Site Alpha",
            metrics: { occ_pt: 0 },
          },
        ]}
        initialHasServerData
      />,
    );

    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});

const RECORDED_TODAY = {
  kind: "recorded",
  evidence: {
    snapshotDate: "2026-09-15",
    computedAt: "2026-09-15T06:00:00.000Z",
    occupiedResidents: 25,
    licensedBeds: 60,
    incidentRatePer1kResidentDays: 0,
    billedRevenueMtdCents: 0,
    laborCostMtdCents: null,
  },
  ageDays: 0,
  stale: false,
} as const;

describe("ExecutiveOverviewPageClient evidence claims", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";
    supabaseMock.loadError = null;
  });

  it("never claims nothing needs attention when measures are unreported", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 125000 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { rev_mtd: 125000 } }]}
        initialHasServerData
      />,
    );

    expect(screen.queryByText("Nothing requires leadership intervention right now.")).not.toBeInTheDocument();
    expect(screen.getByText("No critical alerts recorded in the available data.")).toBeInTheDocument();
    expect(screen.getByText(/measures are not fully reported/)).toBeInTheDocument();
  });

  it("states the page scope instead of leaving the facility chooser ambiguous", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 1 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialHasServerData
      />,
    );

    expect(screen.getByText(/All facilities/)).toBeInTheDocument();
    expect(screen.getByText(/does not narrow it/)).toBeInTheDocument();
  });

  it("withholds an incident rate that has no recorded resident-day denominator", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ inc_rate: 0 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { inc_rate: 0 } }]}
        initialSnapshot={{ kind: "never_recorded" }}
        initialHasServerData
      />,
    );

    expect(
      screen.getByText("No resident-day count is recorded with this figure, so the rate cannot be read."),
    ).toBeInTheDocument();
  });

  it("shows the denominator when the run recorded one", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ inc_rate: 0 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { inc_rate: 0 } }]}
        initialSnapshot={RECORDED_TODAY}
        initialHasServerData
      />,
    );

    expect(screen.getByText(/750 resident-days \(25 residents × 30 days\)/)).toBeInTheDocument();
  });

  it("reads a facility with nothing recorded as not observed rather than stable", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 1 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialAssuranceHeatMap={[
          {
            facilityId: "site-a",
            facilityName: "Site Alpha",
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
          },
        ]}
        initialAssuranceTrends={[
          {
            facilityId: "site-a",
            facilityName: "Site Alpha",
            latestHeatScore: 0,
            peakHeatScore: 0,
            avgHeatScore: 0,
            observedDays: 0,
            days: 7,
            lastObservedDate: null,
            points: Array.from({ length: 7 }, (_, index) => ({
              date: `2026-09-0${index + 1}`,
              watchStarts: 0,
              escalations: 0,
              integrityFlags: 0,
              criticalResidents: 0,
              heatScore: 0,
              heatBand: "stable" as const,
              observed: false,
            })),
          },
        ]}
        initialHasServerData
      />,
    );

    expect(screen.getByText("Not observed")).toBeInTheDocument();
    expect(screen.getByText("Nothing recorded yet")).toBeInTheDocument();
    expect(screen.getByText("0 of 7 days recorded")).toBeInTheDocument();
  });

  it("labels the portfolio occupancy footer with the facilities it covers", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ occ_pt: 0.33 }}
        initialOccupancyContext={{
          occupiedResidents: 22,
          licensedBeds: 66,
          occupancyPct: 33,
          allFacilitiesPosted: false,
          postedFacilityCount: 2,
          totalFacilityCount: 5,
        }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { occ_pt: 0.917 } }]}
        initialHasServerData
      />,
    );

    // The tile and the comparison footer must name the same coverage.
    expect(
      screen.getAllByText("Occupancy across reporting facilities · 2 of 5 facilities").length,
    ).toBe(2);
    expect(
      screen.getAllByText(/22 occupied ÷ 66 beds at the 2 reporting facilities/).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
