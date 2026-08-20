import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ExecutiveAlertsPage from "@/app/(admin)/executive/alerts/page";
import { fetchExecutiveAlerts } from "@/lib/exec-alerts";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/executive/alerts",
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: null,
    organizationId: authMock.organizationId,
    appRole: "owner",
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/exec-alerts", () => ({
  fetchExecutiveAlerts: vi.fn(async () => []),
  acknowledgeExecutiveAlert: vi.fn(),
}));

describe("ExecutiveAlertsPage auth hydration", () => {
  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveAlertsPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    vi.mocked(fetchExecutiveAlerts).mockClear();

    render(<ExecutiveAlertsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(fetchExecutiveAlerts).not.toHaveBeenCalled();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    vi.mocked(fetchExecutiveAlerts).mockReset();
    vi.mocked(fetchExecutiveAlerts).mockRejectedValue(new Error("Unable to load alerts."));

    render(<ExecutiveAlertsPage />);

    expect(await screen.findByText("Unable to load alerts.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
