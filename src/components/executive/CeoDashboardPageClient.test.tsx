import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CeoDashboardPageClient from "@/components/executive/CeoDashboardPageClient";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/components/executive/executive-nav-v2", () => ({
  ExecutiveNavV2: () => <div data-testid="executive-nav-v2" />,
}));

describe("CeoDashboardPageClient organization gap handling", () => {
  it("suppresses the legacy org crash string while auth hydrates", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(
      <CeoDashboardPageClient
        initialKpis={null}
        initialAlerts={[]}
        initialError="Organization missing on profile."
      />,
    );

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(
      <CeoDashboardPageClient
        initialKpis={null}
        initialAlerts={[]}
        initialError="Organization missing on profile."
      />,
    );

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("still surfaces real fetch failures after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";

    render(
      <CeoDashboardPageClient
        initialKpis={null}
        initialAlerts={[]}
        initialError="Failed to load CEO dashboard."
      />,
    );

    expect(screen.getByText("Failed to load CEO dashboard.")).toBeInTheDocument();
  });
});
