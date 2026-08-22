import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveEntityDetailPage, {
  EXECUTIVE_ENTITY_DETAIL_EMPTY_FACILITIES_MESSAGE,
  EXECUTIVE_ENTITY_DETAIL_LOADING_MESSAGE,
} from "@/app/(admin)/admin/executive/entity/[id]/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  entityError: null as string | null,
  entity: null as { id: string; name: string; organization_id: string } | null,
  facilities: [] as { id: string; name: string }[],
  facilitiesError: null as string | null,
}));

const fetchExecutiveKpiSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ent-anon-1" }),
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
      if (table === "entities") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => {
                  if (supabaseMock.entityError) {
                    return { data: null, error: { message: supabaseMock.entityError } };
                  }
                  return { data: supabaseMock.entity, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "facilities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  order: async () => {
                    if (supabaseMock.facilitiesError) {
                      return { data: null, error: { message: supabaseMock.facilitiesError } };
                    }
                    return { data: supabaseMock.facilities, error: null };
                  },
                }),
              }),
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

vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveEntityDetailPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    supabaseMock.entityError = null;
    supabaseMock.entity = null;
    supabaseMock.facilities = [];
    supabaseMock.facilitiesError = null;
    fetchExecutiveKpiSnapshotMock.mockReset();
    fetchExecutiveKpiSnapshotMock.mockResolvedValue({
      census: { occupiedResidents: 0, licensedBeds: 0, occupancyPct: 0, presence: null },
      financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
      clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
      compliance: { openSurveyDeficiencies: 0 },
    });
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveEntityDetailPage />);

    expect(screen.getByRole("status")).toHaveTextContent(EXECUTIVE_ENTITY_DETAIL_LOADING_MESSAGE);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveEntityDetailPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(EXECUTIVE_ENTITY_DETAIL_LOADING_MESSAGE)).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.entityError = "Could not load entity portfolio.";

    render(<ExecutiveEntityDetailPage />);

    expect(await screen.findByText("Could not load entity portfolio.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows named empty facilities copy when the entity has no facilities", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.entity = { id: "ent-anon-1", name: "Anon Entity LLC", organization_id: "org-anon-1" };
    supabaseMock.facilities = [];

    render(<ExecutiveEntityDetailPage />);

    expect(await screen.findByText(EXECUTIVE_ENTITY_DETAIL_EMPTY_FACILITIES_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("renders facility cards when org context is present", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.entity = { id: "ent-anon-1", name: "Anon Entity LLC", organization_id: "org-anon-1" };
    supabaseMock.facilities = [{ id: "fac-anon-1", name: "Anon Facility" }];

    render(<ExecutiveEntityDetailPage />);

    expect(await screen.findByText("Anon Facility")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Facility view" })).toHaveAttribute(
      "href",
      "/admin/executive/facility/fac-anon-1",
    );
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
