import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminDashboardPageClient } from "@/components/admin/AdminDashboardPageClient";

const authMock = vi.hoisted(() => ({
  loading: true,
  appRole: "owner",
  organizationId: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    appRole: authMock.appRole,
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
}));

vi.mock("@/stores/dashboard-snapshot-cache", () => ({
  useDashboardSnapshotCache: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getFresh: () => null,
      setEntry: vi.fn(),
    }),
}));

vi.mock("@/lib/admin-dashboard-snapshot", () => ({
  fetchAdminDashboardSnapshot: vi.fn(),
}));

describe("AdminDashboardPageClient organization gap handling", () => {
  it("shows skeletons instead of the legacy org crash string while auth hydrates", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    const { container } = render(
      <AdminDashboardPageClient
        initialSnapshot={null}
        initialError="Organization missing on profile."
        initialFacilityId={null}
      />,
    );

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Triage unavailable")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-pulse, [class*='Skeleton']")).toBeTruthy();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(
      <AdminDashboardPageClient
        initialSnapshot={null}
        initialError="Organization missing on profile."
        initialFacilityId={null}
      />,
    );

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Triage unavailable")).not.toBeInTheDocument();
  });
});
