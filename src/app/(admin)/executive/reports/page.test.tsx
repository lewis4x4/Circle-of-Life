import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveSavedReportsPage from "@/app/(admin)/executive/reports/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner" as const,
}));

const queryMock = vi.hoisted(() => ({
  data: undefined as { rows: []; facilities: [] } | undefined,
  isPending: false,
  error: null as Error | null,
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
    isPending: queryMock.isPending,
    error: queryMock.error,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

vi.mock("@/components/common/source-readiness-callout", () => ({
  SourceReadinessCallout: () => <div data-testid="source-readiness" />,
}));

describe("ExecutiveSavedReportsPage auth hydration", () => {
  beforeEach(() => {
    queryMock.data = undefined;
    queryMock.isPending = false;
    queryMock.error = null;
    authMock.user = null;
    authMock.appRole = "owner";
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveSavedReportsPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveSavedReportsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names portfolio scope in the header subtitle", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";

    render(<ExecutiveSavedReportsPage />);

    expect(
      screen.getByText(
        /Organization portfolio — saved definitions and exports roll up all facilities in your organization, not a single-facility board view\./,
      ),
    ).toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    queryMock.error = new Error("Could not load saved reports.");

    render(<ExecutiveSavedReportsPage />);

    expect(screen.getByText("Could not load saved reports.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("suppresses the org gap when org-scoped rows are already on screen", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    queryMock.data = {
      rows: [
        {
          id: "report-1",
          name: "Weekly ops",
          template: "custom",
          parameters: {},
          organization_id: "org-anon-1",
          created_by: "user-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
          last_generated_at: null,
        },
      ],
      facilities: [],
    };

    render(<ExecutiveSavedReportsPage />);

    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
