import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsuranceRenewalPackagesPage, {
  INSURANCE_RENEWAL_PACKAGES_LOADING_PROFILE_COPY,
} from "./page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  appRole: null as string | null,
  user: null as { id: string } | null,
}));

const queryMock = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: true,
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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: queryMock.data,
    isPending: queryMock.isPending,
    error: queryMock.error,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("../insurance-hub-nav", () => ({
  InsuranceHubNav: () => <nav aria-label="Insurance hub" />,
}));

describe("InsuranceRenewalPackagesPage organization context", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    authMock.appRole = null;
    authMock.user = null;
    queryMock.data = undefined;
    queryMock.isPending = true;
    queryMock.error = null;
  });

  it("names the wait and suppresses organization gaps while auth hydrates", () => {
    render(<InsuranceRenewalPackagesPage />);

    expect(screen.getByRole("status")).toHaveTextContent(INSURANCE_RENEWAL_PACKAGES_LOADING_PROFILE_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows the named quiet gap after auth resolves without an organization", () => {
    authMock.loading = false;
    queryMock.isPending = false;

    render(<InsuranceRenewalPackagesPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No renewal data packages yet.")).not.toBeInTheDocument();
  });

  it("offers retry only for genuine load failures, never for an organization gap", () => {
    authMock.loading = false;
    queryMock.isPending = false;

    render(<InsuranceRenewalPackagesPage />);

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps genuine fetch failures in the retryable banner", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.isPending = false;
    queryMock.error = new Error("Unable to load renewal data packages.");

    render(<InsuranceRenewalPackagesPage />);

    expect(screen.getByText("Unable to load renewal data packages.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });
});
