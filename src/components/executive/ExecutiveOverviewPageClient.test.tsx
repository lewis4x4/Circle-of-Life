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
  initialMetricDates: {},
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

describe("ExecutiveOverviewPageClient header", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";
    supabaseMock.loadError = null;
  });

  it("does not flash role-home framing on first paint while auth is loading", () => {
    authMock.loading = true;
    authMock.appRole = "facility_admin";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(screen.queryByText(/Loading role home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facility Admin home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Owner home/)).not.toBeInTheDocument();
  });

  it("carries the page's own scope, not the shell's role framing", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 1 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialHasServerData
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Executive intelligence" })).toBeInTheDocument();
    expect(screen.getByText(/All facilities · 1 in scope/)).toBeInTheDocument();
    // Role labelling belongs to the shell; repeating it here spent a line of
    // the first screen on something the operator already knows.
    expect(screen.queryByText(/Owner home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/portfolio movement, exception pressure/)).not.toBeInTheDocument();
  });
});

describe("ExecutiveOverviewPageClient information hierarchy", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.organizationId = "org-1";
    supabaseMock.loadError = null;
  });

  function renderPortfolio() {
    return render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 0 }}
        initialFacilities={[
          { id: "site-a", name: "Site Alpha", metrics: {} },
          { id: "site-b", name: "Site Beta", metrics: {} },
        ]}
        initialSnapshot={RECORDED_TODAY}
        initialHasServerData
      />,
    );
  }

  it("puts the facility comparison ahead of the figures and their explanations", () => {
    renderPortfolio();

    const comparison = screen.getByRole("heading", { name: /Portfolio comparison/ });
    const figures = screen.getByRole("heading", { name: "Portfolio figures" });

    expect(comparison.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states coverage once, with the per-measure evidence behind a disclosure", () => {
    renderPortfolio();

    expect(screen.getByRole("heading", { name: "Coverage incomplete" })).toBeInTheDocument();
    expect(screen.getByText("View coverage")).toBeInTheDocument();
    // The old page repeated every gap in a second full-height card.
    expect(screen.queryByText("Information not received")).not.toBeInTheDocument();
    expect(screen.queryByText("Monitoring coverage")).not.toBeInTheDocument();
  });

  it("offers the gaps as follow-up work with destinations that exist", () => {
    renderPortfolio();

    expect(screen.getByRole("heading", { name: "Reporting follow-up" })).toBeInTheDocument();
    const payroll = screen.getByRole("link", { name: /Open payroll/ });
    expect(payroll).toHaveAttribute("href", "/admin/payroll");
  });

  it("keeps the recorded-alert empty state to a compact row", () => {
    renderPortfolio();

    expect(screen.getByText("No critical alerts recorded in the available data.")).toBeInTheDocument();
    expect(screen.getByText(/Recorded alerts only/)).toBeInTheDocument();
    // Arrow behaviour used to need a full-width paragraph of its own.
    expect(screen.queryByText(/Arrows mark movement against the dated recording/)).not.toBeInTheDocument();
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

  it("labels a projected resident-day denominator as an estimate", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ inc_rate: 0 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { inc_rate: 0 } }]}
        initialSnapshot={RECORDED_TODAY}
        initialHasServerData
      />,
    );

    // The visible qualifier says estimate; the arithmetic and the reason it is
    // only an estimate sit in the tile's own disclosure.
    expect(
      screen.getByText("Estimated · incidents in the trailing 30 days per 1,000 resident-days."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/750 resident-days is 25 residents in census on 2026-09-15 × 30 days/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Daily census across the window is not recorded/)).toBeInTheDocument();
  });

  it("dates a figure the latest run did not write, instead of reading it as today's", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 0, survey_rd: 0.92 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: { survey_rd: 0.92 } }]}
        initialSnapshot={RECORDED_TODAY}
        initialMetricDates={{ rev_mtd: "2026-09-15", survey_rd: "2026-09-12" }}
        initialHasServerData
      />,
    );

    // The header still names the run; the figure the run did not write names
    // its own day, where it is read.
    expect(screen.getAllByText("Recorded 2026-09-12, 3 days ago.").length).toBeGreaterThanOrEqual(1);
    // Coverage marks that one measure, and only that one, as an earlier day.
    const normalised = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ") ?? "";
    expect(
      screen.getAllByText((_, node) => normalised(node).includes("Survey readiness Earlier day")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryAllByText((_, node) => normalised(node).includes("Billing Earlier day")).length,
    ).toBe(0);
  });

  it("reads a portfolio-wide zero against the period and the invoices it counts", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 0 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialSnapshot={RECORDED_TODAY}
        initialHasServerData
      />,
    );

    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getAllByText(/Invoices dated 2026-09-01 through 2026-09-15\./).length)
      .toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/Draft and voided invoices are not included\./).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not blame payroll for a labor percentage with no revenue behind it", () => {
    render(
      <ExecutiveOverviewPageClient
        {...emptyProps}
        initialMetrics={{ rev_mtd: 0 }}
        initialFacilities={[{ id: "site-a", name: "Site Alpha", metrics: {} }]}
        initialSnapshot={{
          ...RECORDED_TODAY,
          evidence: { ...RECORDED_TODAY.evidence, laborCostMtdCents: 480_000 },
        }}
        initialHasServerData
      />,
    );

    expect(
      screen.getByText(/Payroll hours are loaded, but nothing was billed this period/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No payroll hours have been loaded for this period."))
      .not.toBeInTheDocument();
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
