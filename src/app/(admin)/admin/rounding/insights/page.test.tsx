import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsightsPage from "@/app/(admin)/admin/rounding/insights/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "fac-anon-1" as string | null,
  availableFacilities: [] as Array<{ id: string; name: string }>,
}));

const supabaseMock = vi.hoisted(() => ({
  queryError: null as { message: string } | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: facilityMock.selectedFacilityId,
    availableFacilities: facilityMock.availableFacilities,
  }),
}));

function buildQuery() {
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({
      data: supabaseMock.rows,
      error: supabaseMock.queryError,
    })),
  };
  return chain;
}

vi.mock("@/lib/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/client")>();
  return {
    ...actual,
    createClient: () => ({
      from: vi.fn(() => ({
        select: vi.fn(() => buildQuery()),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    }),
    isBrowserSupabaseConfigured: () => true,
  };
});

vi.mock("../rounding-hub-nav", () => ({
  RoundingHubNav: () => <div data-testid="rounding-hub-nav" />,
}));

describe("InsightsPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.selectedFacilityId = "fac-anon-1";
    facilityMock.availableFacilities = [{ id: "fac-anon-1", name: "Anon Facility A" }];
    supabaseMock.queryError = null;
    supabaseMock.rows = [];
  });

  it("does not show the legacy org crash banner while auth is hydrating", async () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<InsightsPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Could not load Smart rounding insights. Confirm facility scope and retry."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading insights")).toBeInTheDocument();
    expect(screen.queryByLabelText("Insight backlog: 0")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<InsightsPage />);

    await waitFor(() => {
      expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Could not load Smart rounding insights. Confirm facility scope and retry."),
    ).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.queryError = { message: "permission denied for table resident_safety_insights" };

    render(<InsightsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Could not load Smart rounding insights. Confirm facility scope and retry."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("keeps the named empty board when the query succeeds with zero rows", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.rows = [];

    render(<InsightsPage />);

    await waitFor(() => {
      expect(screen.getByText("No rounding activity insights at Anon Facility A")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Insight backlog: 0")).toBeInTheDocument();
    expect(
      screen.getByText(/No insight cycle has started at Anon Facility A yet/),
    ).toBeInTheDocument();
  });

  it("renders populated insight rows without inventing counts", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.rows = [
      {
        id: "insight-anon-1",
        resident_id: "res-anon-1",
        facility_id: "fac-anon-1",
        insight_type: "pattern_detected",
        severity: "medium",
        title: "Observation pattern flagged",
        body: "Anonymous fixture insight body.",
        clinical_domains: ["mobility"],
        status: "new",
        ai_model: "fixture-model",
        created_at: "2026-08-21T12:00:00.000Z",
        residents: { first_name: "Resident", last_name: "One" },
        facilities: { name: "Anon Facility A" },
      },
    ];

    render(<InsightsPage />);

    await waitFor(() => {
      expect(screen.getByText("Observation pattern flagged")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Insight backlog: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("New patterns: 1")).toBeInTheDocument();
    expect(screen.getByText(/Clinical pattern detection/)).toBeInTheDocument();
    expect(screen.queryByText(/No insight cycle has started/)).not.toBeInTheDocument();
  });

  it("uses stand-alone missing-name gap copy when the facility name has not resolved", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.availableFacilities = [];
    supabaseMock.rows = [];

    render(<InsightsPage />);

    await waitFor(() => {
      expect(screen.getByText("No rounding activity insights posted")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/No facility name posted/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/at No facility name posted/)).not.toBeInTheDocument();
  });

  it("uses top-bar filter copy in the subtitle when no facility is selected", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.selectedFacilityId = null;
    facilityMock.availableFacilities = [];

    render(<InsightsPage />);

    expect(screen.getAllByText(/Insights are per facility.*top-bar facility filter/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/at No facility name posted/)).not.toBeInTheDocument();
    expect(screen.getByText("Insights operate per facility")).toBeInTheDocument();
  });
});
