import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SafetyScoresPage from "@/app/(admin)/admin/rounding/safety/page";
import { SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY } from "@/lib/rounding/safety-board-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "fac-anon-1" as string | null,
  availableFacilities: [] as Array<{ id: string; name: string }>,
}));

const fetchMock = vi.hoisted(() => ({
  outcome: {
    kind: "success" as "success" | "unexpected_error",
    rows: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  },
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

vi.mock("@/lib/rounding/safety-board-fetch", () => ({
  fetchSafetyBoardScores: vi.fn(async () => {
    if (fetchMock.outcome.kind === "unexpected_error") {
      return { kind: "unexpected_error", error: fetchMock.outcome.error };
    }
    return { kind: "success", rows: fetchMock.outcome.rows };
  }),
}));

vi.mock("@/lib/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/client")>();
  return {
    ...actual,
    createClient: () => ({}),
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
    fetchMock.outcome = { kind: "success", rows: [], error: null };
  });

  it("does not show the legacy org crash banner while auth is hydrating", async () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<SafetyScoresPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY)).not.toBeInTheDocument();
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
    expect(screen.queryByText(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY)).not.toBeInTheDocument();
  });

  it("surfaces unexpected fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchMock.outcome = {
      kind: "unexpected_error",
      rows: [],
      error: { message: "permission denied for table resident_safety_scores" },
    };

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY)).toBeInTheDocument();
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm facility scope and retry")).not.toBeInTheDocument();
  });

  it("keeps the named empty board when recoverable fetch issues resolve to zero rows", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchMock.outcome = { kind: "success", rows: [], error: null };

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("No safety scores at Anon Facility A")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Critical risk: 0")).toBeInTheDocument();
    expect(screen.queryByText(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY)).not.toBeInTheDocument();
  });

  it("renders populated score rows without resident names in fixtures", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchMock.outcome = {
      kind: "success",
      rows: [
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
      ],
      error: null,
    };

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("One, Resident")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("uses stand-alone missing-name gap copy when the facility name has not resolved", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.availableFacilities = [];
    fetchMock.outcome = { kind: "success", rows: [], error: null };

    render(<SafetyScoresPage />);

    await waitFor(() => {
      expect(screen.getByText("No safety scores posted")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/No facility name posted/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/at No facility name posted/)).not.toBeInTheDocument();
  });

  it("uses top-bar filter copy in the subtitle when no facility is selected", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    facilityMock.selectedFacilityId = null;
    facilityMock.availableFacilities = [];

    render(<SafetyScoresPage />);

    expect(screen.getAllByText(/Safety scores are per facility.*top-bar facility filter/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/at No facility name posted/)).not.toBeInTheDocument();
    expect(screen.getByText("Safety scores operate per facility")).toBeInTheDocument();
  });
});
