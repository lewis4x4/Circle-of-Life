import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import JournalEntriesListPage from "@/app/(admin)/finance/journal-entries/page";
import {
  JOURNAL_ENTRIES_EMPTY_LIST_TITLE,
  JOURNAL_ENTRIES_LOADING_COPY,
  JOURNAL_ENTRIES_LOADING_PROFILE_COPY,
} from "@/lib/finance/journal-entries-display-copy";

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
    status: string;
    entry_date: string;
    memo: string | null;
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

function renderJournalEntriesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<JournalEntriesListPage />, { wrapper });
}

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

describe("JournalEntriesListPage auth hydration", () => {
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

    renderJournalEntriesPage();

    expect(screen.getByText(JOURNAL_ENTRIES_LOADING_PROFILE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    renderJournalEntriesPage();

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(JOURNAL_ENTRIES_EMPTY_LIST_TITLE)).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.queryError = "permission denied for table journal_entries";

    renderJournalEntriesPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied for table journal_entries",
    );
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("names the empty journal list when org is present and no entries load", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.rows = [];

    renderJournalEntriesPage();

    await waitFor(() => {
      expect(screen.getByText(JOURNAL_ENTRIES_EMPTY_LIST_TITLE)).toBeInTheDocument();
    });
    expect(screen.queryByText(JOURNAL_ENTRIES_LOADING_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("loads journal entries when organization is present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.rows = [
      {
        id: "00000000-0000-4000-8000-00000000je01",
        status: "posted",
        entry_date: "2026-08-01",
        memo: "Period close adjustment",
      },
    ];

    renderJournalEntriesPage();

    await waitFor(() => {
      expect(screen.getByText("Period close adjustment")).toBeInTheDocument();
    });
    expect(screen.getByText("1 rows")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
