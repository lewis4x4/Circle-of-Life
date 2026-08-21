import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SafetyScoresPage from "@/app/(admin)/admin/rounding/safety/page";

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
      })),
    }),
    isBrowserSupabaseConfigured: () => true,
  };
});

vi.mock("../rounding-hub-nav", () => ({
  RoundingHubNav: () => <div data-testid="rounding-hub-nav" />,
}));

describe("SafetyScoresPage auth hydration", () => {
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

    render(<SafetyScoresPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load safety scores. Confirm facility scope and retry.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading safety scores")).toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load safety scores. Confirm facility scope and retry.")).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.queryError = { message: "permission denied for table resident_safety_scores" };

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Could not load safety scores. Confirm facility scope and retry."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("keeps the named empty board when the query succeeds with zero rows", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.rows = [];

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("No safety scores at Anon Facility A")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Critical risk: 0")).toBeInTheDocument();
  });

  it("renders populated score rows without resident names in fixtures", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.rows = [
      {
        id: "score-anon-1",
        resident_id: "res-anon-1",
        facility_id: "fac-anon-1",
        score: 42,
        risk_tier: "moderate",
        component_scores: {
          observation_compliance: 80,
          incident_recency: 1,
          medication_adherence: 90,
        },
        previous_score: 40,
        score_delta: 2,
        computed_at: "2026-08-21T12:00:00.000Z",
        residents: { first_name: "Resident", last_name: "One", room_number: "101" },
        facilities: { name: "Anon Facility A" },
      },
    ];

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("One, Resident")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("uses named facility-gap copy in the subtitle when the facility name has not resolved", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.availableFacilities = [];

    render(<SafetyScoresPage />);

    expect(
      screen.getByText(/Composite safety scores updated daily.*No facility name posted\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/selected facility/)).not.toBeInTheDocument();
  });
});
