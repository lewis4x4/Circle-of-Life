import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LedgerPage from "@/app/(admin)/finance/ledger/page";
import {
  LEDGER_EMPTY_LIST_TITLE,
  LEDGER_LOADING_ENTRIES_COPY,
  LEDGER_LOADING_PROFILE_COPY,
} from "@/lib/finance/ledger-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  queryError: null as string | null,
  rows: [] as {
    id: string;
    memo: string | null;
    entry_date: string;
    posted_at: string | null;
  }[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (selector: (state: { selectedFacilityId: string | null }) => unknown) =>
    selector({ selectedFacilityId: facilityMock.selectedFacilityId }),
}));

vi.mock("../finance-hub-nav", () => ({
  FinanceHubNav: () => <div data-testid="finance-hub-nav" />,
}));

vi.mock("@/components/ui/motion-list", () => ({
  MotionList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "journal_entries") {
        throw new Error(`unexpected table ${table}`);
      }
      const terminal = async () => {
        if (supabaseMock.queryError) {
          return { data: null, error: { message: supabaseMock.queryError } };
        }
        return { data: supabaseMock.rows, error: null };
      };
      const builder = {
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        or: () => builder,
        then: (
          onFulfilled: (value: Awaited<ReturnType<typeof terminal>>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => terminal().then(onFulfilled, onRejected),
      };
      return {
        select: () => builder,
      };
    },
  }),
}));

describe("LedgerPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    facilityMock.selectedFacilityId = null;
    supabaseMock.queryError = null;
    supabaseMock.rows = [];
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<LedgerPage />);

    expect(screen.getByText(LEDGER_LOADING_PROFILE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<LedgerPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(LEDGER_EMPTY_LIST_TITLE)).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.queryError = "permission denied for table journal_entries";

    render(<LedgerPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied for table journal_entries",
    );
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("names the empty ledger list when org is present and no entries load", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.rows = [];

    render(<LedgerPage />);

    await waitFor(() => {
      expect(screen.getByText(LEDGER_EMPTY_LIST_TITLE)).toBeInTheDocument();
    });
    expect(screen.queryByText(LEDGER_LOADING_ENTRIES_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("loads posted journal headers when organization is present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.rows = [
      {
        id: "00000000-0000-4000-8000-00000000je01",
        memo: "Period close adjustment",
        entry_date: "2026-08-01",
        posted_at: "2026-08-01T12:00:00.000Z",
      },
    ];

    render(<LedgerPage />);

    await waitFor(() => {
      expect(screen.getByText("Period close adjustment")).toBeInTheDocument();
    });
    expect(screen.getByText("1 rows")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
