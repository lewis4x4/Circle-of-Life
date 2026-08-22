import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminQualityHubPage from "@/app/(admin)/admin/quality/page";
import { QUALITY_HUB_LOADING_MESSAGE } from "@/lib/quality/quality-hub-page-state";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner" as const,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-4000-8000-00000000fac1" as string | null,
}));

const ORG_UUID = "00000000-0000-4000-8000-00000000org1";

const queryMock = vi.hoisted(() => ({
  data: undefined as
    | {
        measures: Array<Record<string, unknown>>;
        latest: Array<Record<string, unknown>>;
        pbjRows: Array<Record<string, unknown>>;
      }
    | undefined,
  isPending: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: facilityMock.selectedFacilityId,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: queryMock.data,
    isPending: queryMock.isPending,
    isError: queryMock.isError,
    error: queryMock.error,
    refetch: queryMock.refetch,
  }),
}));

vi.mock("./quality-hub-nav", () => ({
  QualityHubNav: () => <div data-testid="quality-hub-nav" />,
}));

describe("AdminQualityHubPage auth hydration", () => {
  beforeEach(() => {
    queryMock.data = undefined;
    queryMock.isPending = false;
    queryMock.isError = false;
    queryMock.error = null;
    authMock.user = null;
    authMock.appRole = "owner";
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AdminQualityHubPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.getByText(QUALITY_HUB_LOADING_MESSAGE)).toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminQualityHubPage />);

    expect(screen.getAllByText("No organization on this profile").length).toBeGreaterThan(0);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No catalog measures posted.")).not.toBeInTheDocument();
  });

  it("names the organization gap on KPI tiles instead of zero", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminQualityHubPage />);

    const metricTiles = screen.getAllByText("No organization on this profile");
    expect(metricTiles.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0", { selector: "p.text-4xl" })).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = ORG_UUID;
    queryMock.isError = true;
    queryMock.error = new Error("permission denied for table quality_measures");

    render(<AdminQualityHubPage />);

    expect(screen.getByText("permission denied for table quality_measures")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("uses named empty catalog copy without inventing measures", () => {
    authMock.loading = false;
    authMock.organizationId = ORG_UUID;
    queryMock.data = { measures: [], latest: [], pbjRows: [] };

    render(<AdminQualityHubPage />);

    expect(screen.getByText("No catalog measures posted.")).toBeInTheDocument();
    expect(screen.queryByText("No Baseline Quality Measures.")).not.toBeInTheDocument();
  });
});
