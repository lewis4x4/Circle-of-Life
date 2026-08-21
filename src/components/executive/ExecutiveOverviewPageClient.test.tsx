import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutiveOverviewPageClient } from "./ExecutiveOverviewPageClient";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";

const authMock = vi.hoisted(() => ({
  loading: true,
  appRole: "",
  organizationId: null as string | null,
}));

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
  createClient: () => ({}),
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
  initialHasServerData: false,
};

describe("ExecutiveOverviewPageClient role-home subtitle", () => {
  it("shows a named loading gap instead of a default role home while auth is loading", () => {
    authMock.loading = true;
    authMock.appRole = "facility_admin";
    authMock.organizationId = null;

    render(<ExecutiveOverviewPageClient {...emptyProps} />);

    expect(
      screen.getByText(
        "Loading role home — portfolio movement, exception pressure, leadership decisions only.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Facility Admin home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Owner home/)).not.toBeInTheDocument();
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
