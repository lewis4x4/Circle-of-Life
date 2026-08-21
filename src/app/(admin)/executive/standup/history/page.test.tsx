import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveStandupHistoryPage from "@/app/(admin)/executive/standup/history/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner" as const,
}));

const queryMock = vi.hoisted(() => ({
  data: undefined as
    | { rows: []; importJobs: []; importJobsError: null }
    | undefined,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: queryMock.data,
    isFetching: queryMock.isFetching,
    error: queryMock.error,
    refetch: queryMock.refetch,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/executive/standup", () => ({
  buildStandupImportCommand: () => "npm run standup:import -- --org org-anon-1",
  buildStandupPdfUrl: (weekOf: string) => `/api/executive/standup/${weekOf}/pdf`,
  currentStandupWeekOf: () => "2026-04-07",
  fetchStandupHistory: vi.fn(),
  fetchStandupImportJobs: vi.fn(),
  generateExecutiveStandupDraft: vi.fn(),
}));

vi.mock("../../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveStandupHistoryPage auth hydration", () => {
  beforeEach(() => {
    queryMock.data = undefined;
    queryMock.isFetching = false;
    queryMock.error = null;
    authMock.user = null;
    authMock.appRole = "owner";
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupHistoryPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveStandupHistoryPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    queryMock.error = new Error("Could not load standup history.");

    render(<ExecutiveStandupHistoryPage />);

    expect(screen.getByText("Could not load standup history.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("suppresses the org gap when standup weeks are already on screen", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    queryMock.data = {
      rows: [
        {
          id: "snap-1",
          weekOf: "2026-04-07",
          generatedAt: "2026-04-07T12:00:00.000Z",
          publishedAt: null,
          status: "draft",
          completenessPct: 42,
          confidenceBand: "medium",
        },
      ],
      importJobs: [],
      importJobsError: null,
    };

    render(<ExecutiveStandupHistoryPage />);

    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open week" })).toHaveAttribute(
      "href",
      "/admin/executive/standup/2026-04-07",
    );
  });
});
