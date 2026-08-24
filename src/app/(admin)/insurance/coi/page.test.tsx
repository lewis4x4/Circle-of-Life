import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsuranceCoiPage, { INSURANCE_COI_LOADING_PROFILE_COPY } from "./page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const queryMock = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  isPending: true,
  error: null as Error | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: queryMock.rows,
    isPending: queryMock.isPending,
    error: queryMock.error,
  }),
}));

vi.mock("../insurance-hub-nav", () => ({
  InsuranceHubNav: () => <nav aria-label="Insurance hub" />,
}));

describe("InsuranceCoiPage organization context", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    queryMock.rows = [];
    queryMock.isPending = true;
    queryMock.error = null;
  });

  it("names the wait and suppresses organization gaps while auth hydrates", () => {
    render(<InsuranceCoiPage />);

    expect(screen.getByRole("status")).toHaveTextContent(INSURANCE_COI_LOADING_PROFILE_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap after auth resolves without an organization", () => {
    authMock.loading = false;
    queryMock.isPending = false;

    render(<InsuranceCoiPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps genuine fetch failures in the alert lane", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.isPending = false;
    queryMock.error = new Error("Unable to load certificates of insurance.");

    render(<InsuranceCoiPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load certificates of insurance.");
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the org scope cue when organization context is present", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.isPending = false;

    render(<InsuranceCoiPage />);

    expect(
      screen.getByText(
        "Certificates listed here are scoped to your organization; expiry dates follow Eastern (ET) calendar days.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Expires (ET)")).toBeInTheDocument();
  });
});
