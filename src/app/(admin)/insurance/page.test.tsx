import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminInsuranceHubPage, { INSURANCE_HUB_LOADING_PROFILE_COPY } from "./page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  appRole: "owner",
}));

const queryMock = vi.hoisted(() => ({
  overviewError: null as Error | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[1] === "hub-overview"
      ? { data: undefined, isPending: true, error: queryMock.overviewError }
      : { data: undefined, isPending: true, error: null },
}));

vi.mock("./insurance-hub-nav", () => ({
  InsuranceHubNav: () => <nav aria-label="Insurance hub" />,
}));

describe("AdminInsuranceHubPage organization context", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    authMock.appRole = "owner";
    queryMock.overviewError = null;
  });

  it("names the wait and suppresses organization gaps while auth hydrates", () => {
    render(<AdminInsuranceHubPage />);

    expect(screen.getByRole("status")).toHaveTextContent(INSURANCE_HUB_LOADING_PROFILE_COPY);
    expect(screen.getByText("Role context will appear when the operator profile is ready.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap after auth resolves without an organization", () => {
    authMock.loading = false;

    render(<AdminInsuranceHubPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps genuine overview failures in the alert lane", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.overviewError = new Error("Unable to load insurance overview.");

    render(<AdminInsuranceHubPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load insurance overview.");
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });
});
