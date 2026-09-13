import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalEntryDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  status: "draft", source: "manual", rpc: vi.fn(), push: vi.fn(), refresh: vi.fn(),
  client: {} as Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "journal-1" }), useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("../../finance-hub-nav", () => ({ FinanceHubNav: () => null }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: "actor-1" }, organizationId: "org-1", appRole: "owner" }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.status = "draft";
  mocks.source = "manual";
  mocks.client = {
    rpc: mocks.rpc,
    auth: { getClaims: async () => ({ data: { claims: { sub: "actor-1", session_id: "session-1" } }, error: null }) },
    from(table: string) {
      const rows: Record<string, unknown[]> = {
        journal_entry_lines: [
          { id: "line-1", gl_account_id: "debit-1", line_number: 1, debit_cents: 10000, credit_cents: 0 },
          { id: "line-2", gl_account_id: "credit-1", line_number: 2, debit_cents: 0, credit_cents: 10000 },
        ],
        gl_accounts: [{ id: "debit-1", code: "1000", name: "Cash" }, { id: "credit-1", code: "4000", name: "Revenue" }],
        facilities: [{ id: "facility-1", name: "Facility", entity_id: "entity-1" }],
      };
      const q = {
        select: () => q, eq: () => q, is: () => q, order: () => q, in: () => q,
        maybeSingle: async () => ({ error: null, data: table === "journal_entries" ? {
          id: "journal-1", organization_id: "org-1", entity_id: "entity-1", facility_id: "facility-1",
          source_type: mocks.source, source_id: "source-1", status: mocks.status, memo: "Test journal", entry_date: "2026-09-08", updated_at: "2026-09-08T12:00:00Z",
        } : { name: "Entity" } }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      };
      return q;
    },
  };
});

describe("HFA-009 HFA-010 HFA-011 financial journal commands", () => {
  it("posts the reviewed manual draft through the atomic command and shows rejection", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Accounting period is closed" } });
    render(<JournalEntryDetailPage />);
    const post = await screen.findByRole("button", { name: "Post entry" });
    await waitFor(() => expect(post).toBeEnabled());
    fireEvent.click(post);
    expect(await screen.findByRole("alert")).toHaveTextContent("Accounting period is closed");
    expect(mocks.rpc).toHaveBeenCalledWith("post_finance_journal", { p_id: "journal-1", p_expected_updated_at: "2026-09-08T12:00:00Z" });
  });

  it("reuses a session-bound reversal identity after failure", async () => {
    mocks.status = "posted";
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Receipt failed" } });
    mocks.rpc.mockImplementationOnce(async (_name: string, args: { p_id: string }) => ({ data: { journal_entry_id: args.p_id }, error: null }));
    render(<JournalEntryDetailPage />);
    fireEvent.change(await screen.findByLabelText("Reason for reversal"), { target: { value: "Duplicate source posting" } });
    fireEvent.click(screen.getByRole("button", { name: "Post reversing journal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Receipt failed");
    const id = mocks.rpc.mock.calls[0][1].p_id;
    fireEvent.click(screen.getByRole("button", { name: "Post reversing journal" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/admin/finance/journal-entries/${id}`));
    expect(mocks.rpc.mock.calls[1][1].p_id).toBe(id);
    expect(mocks.rpc.mock.calls[0][0]).toBe("reverse_finance_journal");
  });

  it("offers source draft recovery without pretending its header is already posted", async () => {
    mocks.source = "invoice";
    mocks.rpc.mockResolvedValue({ data: { journal_entry_id: "journal-1" }, error: null });
    render(<JournalEntryDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Recover source posting" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("post_finance_source", { p_source_type: "invoice", p_source_id: "source-1" }));
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });
});
