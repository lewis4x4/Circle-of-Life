import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsuranceRenewalsPage, {
  INSURANCE_RENEWALS_LOADING_LIST_COPY,
  INSURANCE_RENEWALS_LOADING_PROFILE_COPY,
} from "./page";

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

vi.mock("@/components/ui/motion-list", () => ({
  MotionList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("InsuranceRenewalsPage organization context", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    queryMock.rows = [];
    queryMock.isPending = true;
    queryMock.error = null;
  });

  it("names the wait and suppresses organization gaps while auth hydrates", () => {
    render(<InsuranceRenewalsPage />);

    expect(screen.getByText(INSURANCE_RENEWALS_LOADING_PROFILE_COPY)).toBeInTheDocument();
    expect(screen.getByText(INSURANCE_RENEWALS_LOADING_LIST_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap after auth resolves without an organization", () => {
    authMock.loading = false;
    queryMock.isPending = false;

    render(<InsuranceRenewalsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps genuine fetch failures in the alert lane", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    queryMock.isPending = false;
    queryMock.error = new Error("Unable to load insurance renewals.");

    render(<InsuranceRenewalsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load insurance renewals.");
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });
});
