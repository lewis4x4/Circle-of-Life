import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsurancePolicyDetailPage from "./page";
import {
  INSURANCE_POLICY_DETAIL_AUTH_LOADING_COPY,
  INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY,
  INSURANCE_POLICY_DETAIL_SCOPE_ET_COPY,
  INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
} from "@/lib/insurance/insurance-policy-detail-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  policyResult: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  entityResult: { data: null as { name: string } | null, error: null as { message: string } | null },
  renewalsResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
  claimsResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
  allocsResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
}));

function makeClient() {
  const builder = (
    single: unknown,
    list: unknown[] = [],
    singleError: { message: string } | null = null,
    listError: { message: string } | null = null,
  ) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      maybeSingle: async () => ({ data: single, error: singleError }),
      then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
        Promise.resolve({ data: list, error: listError }).then(resolve),
    };
    return q;
  };

  return {
    from: (table: string) => {
      if (table === "insurance_policies") {
        return builder(supabaseMock.policyResult.data, [], supabaseMock.policyResult.error);
      }
      if (table === "entities") {
        return builder(supabaseMock.entityResult.data, [], supabaseMock.entityResult.error);
      }
      if (table === "insurance_renewals") {
        return builder(null, supabaseMock.renewalsResult.data, null, supabaseMock.renewalsResult.error);
      }
      if (table === "insurance_claims") {
        return builder(null, supabaseMock.claimsResult.data, null, supabaseMock.claimsResult.error);
      }
      if (table === "premium_allocations") {
        return builder(null, supabaseMock.allocsResult.data, null, supabaseMock.allocsResult.error);
      }
      return builder(null);
    },
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "policy-anon-1" }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

const supabaseClient = makeClient();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => supabaseClient,
}));

vi.mock("../../insurance-hub-nav", () => ({
  InsuranceHubNav: () => <nav aria-label="Insurance hub" />,
}));

vi.mock("@/design-system/components/record-detail", () => ({
  RecordDetailHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  ),
  RecordDetailSection: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}));

describe("InsurancePolicyDetailPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    supabaseMock.policyResult = { data: null, error: null };
    supabaseMock.entityResult = { data: null, error: null };
    supabaseMock.renewalsResult = { data: [], error: null };
    supabaseMock.claimsResult = { data: [], error: null };
    supabaseMock.allocsResult = { data: [], error: null };
  });

  it("names the auth wait and never shows the legacy org crash string while hydrating", () => {
    render(<InsurancePolicyDetailPage />);

    expect(screen.getByRole("status")).toHaveTextContent(INSURANCE_POLICY_DETAIL_AUTH_LOADING_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<InsurancePolicyDetailPage />);

    expect(await screen.findByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces named fetch failures instead of raw query throw strings", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.policyResult = {
      data: null,
      error: { message: "permission denied for table insurance_policies" },
    };

    render(<InsurancePolicyDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
    );
    expect(screen.queryByText("permission denied for table insurance_policies")).not.toBeInTheDocument();
  });

  it("names a missing policy without surfacing postgres errors", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.policyResult = { data: null, error: null };

    render(<InsurancePolicyDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY);
  });

  it("stamps the detail view with organization scope and Eastern date cues", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.policyResult = {
      data: {
        id: "policy-anon-1",
        carrier_name: "Example Carrier",
        policy_type: "general_liability",
        policy_number: "GL-001",
        entity_id: "entity-1",
        effective_date: "2024-01-01",
        expiration_date: "2025-01-01",
        status: "active",
        premium_cents: 500000,
        broker_name: null,
        notes: null,
      },
      error: null,
    };
    supabaseMock.entityResult = { data: { name: "COL Entity One" }, error: null };

    render(<InsurancePolicyDetailPage />);

    expect(await screen.findByText(INSURANCE_POLICY_DETAIL_SCOPE_ET_COPY)).toBeInTheDocument();
    expect(screen.getByText(/Effective Jan 1, 2024 through Jan 1, 2025 \(ET\)/)).toBeInTheDocument();
  });
});
