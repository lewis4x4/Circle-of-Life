import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveFacilityDetailPage from "@/app/(admin)/executive/facility/[id]/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const fetchExecutiveKpiSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "facilities") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "11111111-1111-4111-8111-111111111111",
                    name: "Anon Facility",
                    entity_id: "22222222-2222-4222-8222-222222222222",
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
  computeTotalCostOfRisk: vi.fn(async () => ({ ok: false })),
}));

vi.mock("@/lib/resident-assurance/command-center-brief", () => ({
  fetchResidentAssuranceCommandBrief: vi.fn(async () => null),
  fetchResidentAssuranceFacilityTrendSeries: vi.fn(async () => []),
}));

vi.mock("../../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveFacilityDetailPage auth hydration", () => {
  beforeEach(() => {
    fetchExecutiveKpiSnapshotMock.mockReset();
    fetchExecutiveKpiSnapshotMock.mockResolvedValue({
      census: { occupiedResidents: 0, licensedBeds: 0, occupancyPct: 0, presence: null },
      financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
      clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
      compliance: { openSurveyDeficiencies: 0 },
      workforce: { certificationsExpiring30d: 0 },
      infection: { activeOutbreaks: 0 },
    });
  });

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
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names facility scope in the header subtitle", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";

    render(<ExecutiveFacilityDetailPage />);

    expect(
      screen.getByText(/This facility — live KPIs from the same engine as the executive overview/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/portfolio roll-up/)).toBeInTheDocument();
  });
});

describe("ExecutiveFacilityDetailPage fetch failures", () => {
  it("surfaces real fetch errors in the rose banner after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchExecutiveKpiSnapshotMock.mockReset();
    fetchExecutiveKpiSnapshotMock.mockRejectedValue(new Error("Unable to reach KPI snapshot."));

    render(<ExecutiveFacilityDetailPage />);

    expect(await screen.findByText("Unable to reach KPI snapshot.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
