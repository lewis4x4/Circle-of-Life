import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CooDashboardPage from "@/app/(admin)/executive/coo/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const execRoleKpisMock = vi.hoisted(() => ({
  kpis: null,
  alerts: [],
  facilities: [] as Array<{ id: string; name: string }>,
  loading: true,
  error: null as string | null,
  refetch: vi.fn(),
}));

const facilityStoreMock = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useExecRoleKpis", () => ({
  useExecRoleKpis: () => execRoleKpisMock,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: facilityStoreMock.selectedFacilityId }),
}));

vi.mock("@/components/executive/executive-nav-v2", () => ({
  ExecutiveNavV2: () => <div data-testid="executive-nav-v2" />,
}));

describe("CooDashboardPage auth hydration", () => {
  beforeEach(() => {
    execRoleKpisMock.error = null;
    execRoleKpisMock.loading = true;
    execRoleKpisMock.facilities = [];
    facilityStoreMock.selectedFacilityId = null;
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;
    execRoleKpisMock.error = "Organization missing on profile.";

    render(<CooDashboardPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    execRoleKpisMock.loading = false;

    render(<CooDashboardPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names officer scope in the header subtitle", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;

    render(<CooDashboardPage />);

    expect(screen.getByText(/COO operations board — all facilities in your organization, not the enterprise portfolio roll-up\./)).toBeInTheDocument();
  });

  it("names the facility gap when an id is selected but the name map misses", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    facilityStoreMock.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    execRoleKpisMock.facilities = [];

    render(<CooDashboardPage />);

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/This facility — COO operations board \(facility name not loaded\), not a portfolio roll-up\./),
    ).toBeInTheDocument();
  });

  it("names the selected facility in the subtitle when the name map has it", () => {
    const facilityId = "11111111-1111-1111-1111-111111111111";
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    facilityStoreMock.selectedFacilityId = facilityId;
    execRoleKpisMock.facilities = [{ id: facilityId, name: "Demo ALF" }];

    render(<CooDashboardPage />);

    expect(screen.getByText(/This facility — COO operations board for Demo ALF, not a portfolio roll-up\./)).toBeInTheDocument();
    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
  });
});
