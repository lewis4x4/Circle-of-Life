import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsurancePoliciesPage from "./page";
import {
  INSURANCE_POLICIES_LOADING_COPY,
  INSURANCE_POLICIES_LOADING_PROFILE_COPY,
  INSURANCE_POLICIES_ORG_DATE_SCOPE_COPY,
} from "@/lib/insurance/policies-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  appRole: "owner",
}));

const queryMock = vi.hoisted(() => ({
  entities: [] as { id: string; name: string }[],
  policies: [] as unknown[],
  policiesPending: true,
  policiesError: null as Error | null,
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
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[1] === "policy-entities") {
      return { data: queryMock.entities, isPending: false, error: null, refetch: vi.fn() };
    }
    if (queryKey[1] === "policies") {
      return {
        data: queryMock.policies,
        isPending: queryMock.policiesPending,
        error: queryMock.policiesError,
        refetch: vi.fn(),
      };
    }
    return { data: undefined, isPending: true, error: null, refetch: vi.fn() };
  },
}));

vi.mock("../insurance-hub-nav", () => ({
  InsuranceHubNav: () => <nav aria-label="Insurance hub" />,
}));

describe("InsurancePoliciesPage organization context", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    authMock.appRole = "owner";
    queryMock.entities = [];
    queryMock.policies = [];
    queryMock.policiesPending = true;
    queryMock.policiesError = null;
  });

  it("names the wait and suppresses organization gaps while auth hydrates", () => {
    render(<InsurancePoliciesPage />);

    expect(screen.getByText(INSURANCE_POLICIES_LOADING_PROFILE_COPY)).toBeInTheDocument();
    expect(screen.getByText(INSURANCE_POLICIES_ORG_DATE_SCOPE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap after auth resolves without an organization", () => {
    authMock.loading = false;

    render(<InsurancePoliciesPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps genuine policy fetch failures in the alert lane", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.policiesPending = false;
    queryMock.policiesError = new Error("Unable to load insurance policies.");

    render(<InsurancePoliciesPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load insurance policies.");
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("uses named loading copy while policies fetch", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.policiesPending = true;

    render(<InsurancePoliciesPage />);

    expect(screen.getByText(INSURANCE_POLICIES_LOADING_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
