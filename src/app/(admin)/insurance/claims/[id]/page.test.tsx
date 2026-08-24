import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsuranceClaimDetailPage from "./page";
import {
  INSURANCE_CLAIM_DETAIL_AUTH_LOADING_COPY,
  INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY,
  INSURANCE_CLAIM_DETAIL_SCOPE_ET_COPY,
  INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
} from "@/lib/insurance/insurance-claim-detail-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  claimResult: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  activitiesResult: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
}));

function makeClient() {
  const builder = (single: unknown, list: unknown[] = [], singleError: { message: string } | null = null) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      maybeSingle: async () => ({ data: single, error: singleError }),
      then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
        Promise.resolve({ data: list, error: null }).then(resolve),
    };
    return q;
  };

  return {
    from: (table: string) => {
      if (table === "insurance_claims") {
        return builder(supabaseMock.claimResult.data, [], supabaseMock.claimResult.error);
      }
      if (table === "claim_activities") {
        return builder(null, supabaseMock.activitiesResult.data, supabaseMock.activitiesResult.error);
      }
      return builder(null);
    },
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "claim-anon-1" }),
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
  RecordDetailSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

describe("InsuranceClaimDetailPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    supabaseMock.claimResult = { data: null, error: null };
    supabaseMock.activitiesResult = { data: [], error: null };
  });

  it("names the auth wait and never shows the legacy org crash string while hydrating", () => {
    render(<InsuranceClaimDetailPage />);

    expect(screen.getByRole("status")).toHaveTextContent(INSURANCE_CLAIM_DETAIL_AUTH_LOADING_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<InsuranceClaimDetailPage />);

    expect(await screen.findByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces named fetch failures instead of raw query throw strings", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.claimResult = {
      data: null,
      error: { message: "permission denied for table insurance_claims" },
    };

    render(<InsuranceClaimDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
    );
    expect(screen.queryByText("permission denied for table insurance_claims")).not.toBeInTheDocument();
  });

  it("names a missing claim without surfacing postgres errors", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.claimResult = { data: null, error: null };

    render(<InsuranceClaimDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY);
  });

  it("stamps the detail view with organization scope and Eastern date cues", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.claimResult = {
      data: {
        id: "claim-anon-1",
        claim_number: "GL-2024-001",
        status: "reported",
        date_of_loss: "2024-03-15",
        reported_at: "2024-03-15T14:30:00.000Z",
        reserve_cents: 10000,
        paid_cents: 0,
        incident_id: null,
        description: null,
      },
      error: null,
    };

    render(<InsuranceClaimDetailPage />);

    expect(await screen.findByText(INSURANCE_CLAIM_DETAIL_SCOPE_ET_COPY)).toBeInTheDocument();
    expect(screen.getByText(/Date of loss \(ET\):/)).toBeInTheDocument();
    expect(screen.getByText(/Reported \(ET\):/)).toBeInTheDocument();
  });
});
