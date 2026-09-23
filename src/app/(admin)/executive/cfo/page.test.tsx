import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CfoDashboardPage from "@/app/(admin)/executive/cfo/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const execRoleKpisMock = vi.hoisted(() => ({
  kpis: null as unknown,
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

describe("CfoDashboardPage auth hydration", () => {
  beforeEach(() => {
    execRoleKpisMock.error = null;
    execRoleKpisMock.loading = true;
    execRoleKpisMock.facilities = [];
    execRoleKpisMock.kpis = null;
    facilityStoreMock.selectedFacilityId = null;
  });

  it("labels AR as sent invoices and names the drafts it leaves out (COL-667)", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    // Homewood 2026-09-22: $16,968.00 sent, 57 drafts ($117,108.16) not yet sent.
    execRoleKpisMock.kpis = {
      census: { occupancyPct: null },
      financial: { openInvoicesCount: 10, totalBalanceDueCents: 1_696_800, notYetSentCount: 57, notYetSentCents: 11_710_816 },
      workforce: { certificationsExpiring30d: 0 },
    };

    render(<CfoDashboardPage />);

    expect(screen.getByText("Outstanding AR (sent)")).toBeInTheDocument();
    expect(screen.getByText("Open invoices (sent)")).toBeInTheDocument();
    expect(screen.getByText("57 drafts ($117,108.16) not yet sent — not included")).toBeInTheDocument();
    expect(screen.queryByText("Total AR outstanding")).not.toBeInTheDocument();
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;
    execRoleKpisMock.error = "Organization missing on profile.";

    render(<CfoDashboardPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    execRoleKpisMock.loading = false;

    render(<CfoDashboardPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names officer scope in the header subtitle", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;

    render(<CfoDashboardPage />);

    expect(screen.getByText(/CFO finance board — all facilities in your organization\./)).toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    execRoleKpisMock.error = "Unable to reach KPI snapshot.";

    render(<CfoDashboardPage />);

    expect(screen.getAllByText("Unable to reach KPI snapshot.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names the facility gap when an id is selected but the name map misses", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    facilityStoreMock.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    execRoleKpisMock.facilities = [];

    render(<CfoDashboardPage />);

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/This facility — CFO finance board \(facility name not loaded\), not a portfolio roll-up\./),
    ).toBeInTheDocument();
  });

  it("names the selected facility in the subtitle when the name map has it", () => {
    const facilityId = "11111111-1111-1111-1111-111111111111";
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    execRoleKpisMock.loading = false;
    facilityStoreMock.selectedFacilityId = facilityId;
    execRoleKpisMock.facilities = [{ id: facilityId, name: "Demo ALF" }];

    render(<CfoDashboardPage />);

    expect(screen.getByText(/This facility — CFO finance board for Demo ALF, not a portfolio roll-up\./)).toBeInTheDocument();
    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
  });
});
