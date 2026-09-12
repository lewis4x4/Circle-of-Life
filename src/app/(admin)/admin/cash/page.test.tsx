import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CashPage from "./page";

const state = vi.hoisted(() => ({
  facility: "00000000-0000-0000-0002-000000000001",
  query: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: Object.assign(
  () => ({ selectedFacilityId: state.facility }),
  { getState: () => ({ selectedFacilityId: state.facility }) },
) }));
vi.mock("@/lib/office/meetings", () => ({ fetchActorContext: async () => ({ userId: "synthetic-owner", organizationId: "synthetic-org" }) }));
vi.mock("@/lib/supabase/client", () => {
  const client = {
    rpc: state.rpc,
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder, is: () => builder, order: () => builder, limit: () => builder,
        eq: (key: string, value: string) => { filters[key] = value; return builder; },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve(state.query(table, filters)).then(resolve, reject),
      };
      return builder;
    },
  };
  return { createClient: () => client };
});
const A = "00000000-0000-0000-0002-000000000001";
const B = "00000000-0000-0000-0002-000000000002";
const ok = (data: unknown[]) => ({ data, error: null });
const accounts = [
  { id: "trust-a", resident_id: "resident-a", balance_cents: 100, is_active: true },
  { id: "trust-b", resident_id: "resident-b", balance_cents: 200, is_active: true },
];
function defaultQuery(table: string, filters: Record<string, string>) {
  if (table === "residents") return ok([
    { id: "resident-a", first_name: "Alice", last_name: "Alpha" },
    { id: "resident-b", first_name: "Bob", last_name: "Beta" },
  ]);
  if (table === "petty_cash_accounts") return ok([{ id: `drawer-${filters.facility_id}`, name: filters.facility_id === A ? "Drawer A" : "Drawer B", balance_cents: 300, is_active: true }]);
  if (table === "resident_trust_accounts") return ok(accounts);
  return ok([]);
}
function deferred() {
  let resolve!: (value: ReturnType<typeof ok>) => void;
  const promise = new Promise<ReturnType<typeof ok>>(r => { resolve = r; });
  return { promise, resolve };
}
function transaction(id: string, description: string) {
  return { id, account_id: id, resident_id: id, description, occurred_at: "2026-09-08T12:00:00Z", direction: "deposit", amount_cents: 100, balance_after_cents: 100, category: "other" };
}
describe("HFA-014 HFA-065 Cash ledger response scope", () => {
  beforeEach(() => { state.facility = A; state.query.mockReset().mockImplementation(defaultQuery); state.rpc.mockReset(); });
  afterEach(cleanup);

  it("hides the previous facility ledger immediately while the new facility loads", async () => {
    const pending = deferred();
    const { rerender } = render(<CashPage />);
    await screen.findByText("Drawer A");
    state.query.mockImplementation((table, filters) => filters.facility_id === B ? pending.promise : defaultQuery(table, filters));
    state.facility = B;
    rerender(<CashPage />);
    expect(screen.queryByText("Drawer A")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post transaction" })).not.toBeInTheDocument();
  });

  it("does not replace the current facility with a late response from the prior facility", async () => {
    const prior = deferred();
    state.query.mockImplementation((table, filters) => table === "petty_cash_accounts" && filters.facility_id === A ? prior.promise : defaultQuery(table, filters));
    const { rerender } = render(<CashPage />);
    await waitFor(() => expect(state.query).toHaveBeenCalledWith("petty_cash_accounts", { facility_id: A }));
    state.facility = B;
    rerender(<CashPage />);
    await screen.findByText("Drawer B");
    await act(async () => prior.resolve(ok([{ id: "old-drawer", name: "Drawer A", balance_cents: 900, is_active: true }])));
    expect(screen.getByText("Drawer B")).toBeInTheDocument();
    expect(screen.queryByText("Drawer A")).not.toBeInTheDocument();
  });

  it("does not show another resident's late transaction response under the selected resident", async () => {
    const prior = deferred();
    state.query.mockImplementation((table, filters) => table === "resident_trust_transactions"
      ? filters.account_id === "trust-a" ? prior.promise : ok([transaction("b", "Bob receipt")])
      : defaultQuery(table, filters));
    render(<CashPage />);
    await screen.findByText("Drawer A");
    fireEvent.click(screen.getByRole("tab", { name: "Resident trust" }));
    fireEvent.click(screen.getByRole("button", { name: /Alice Alpha/ }));
    await waitFor(() => expect(state.query).toHaveBeenCalledWith("resident_trust_transactions", { account_id: "trust-a" }));
    fireEvent.click(screen.getByRole("button", { name: /Bob Beta/ }));
    await screen.findByText("Bob receipt");
    await act(async () => prior.resolve(ok([transaction("a", "Alice receipt")])));
    expect(screen.getByText("Bob receipt")).toBeInTheDocument();
    expect(screen.queryByText("Alice receipt")).not.toBeInTheDocument();
  });

  it("clears previous transactions when the newly selected account fails to load", async () => {
    state.query.mockImplementation((table, filters) => table === "resident_trust_transactions"
      ? filters.account_id === "trust-a" ? ok([transaction("a", "Alice receipt")]) : { data: null, error: { message: "Ledger unavailable" } }
      : defaultQuery(table, filters));
    render(<CashPage />);
    await screen.findByText("Drawer A");
    fireEvent.click(screen.getByRole("tab", { name: "Resident trust" }));
    fireEvent.click(screen.getByRole("button", { name: /Alice Alpha/ }));
    await screen.findByText("Alice receipt");
    fireEvent.click(screen.getByRole("button", { name: /Bob Beta/ }));
    await screen.findByText("Ledger unavailable");
    expect(screen.queryByText("Alice receipt")).not.toBeInTheDocument();
    expect(screen.queryByText("No transactions yet.")).not.toBeInTheDocument();
  });

  it.each([false, true])("does not let an old mutation completion interrupt a new ledger or clear its form (facility switch: %s)", async (switchFacility) => {
    const mutation = deferred();
    const currentLedger = deferred();
    state.rpc.mockReturnValue(mutation.promise);
    state.query.mockImplementation((table, filters) => table === "resident_trust_transactions"
      ? filters.account_id === "trust-b" ? currentLedger.promise : ok([])
      : defaultQuery(table, filters));
    const { rerender } = render(<CashPage />);
    await screen.findByText("Drawer A");
    fireEvent.click(screen.getByRole("tab", { name: "Resident trust" }));
    fireEvent.click(screen.getByRole("button", { name: /Alice Alpha/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "1.00" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Alice deposit" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
    if (switchFacility) {
      state.facility = B;
      rerender(<CashPage />);
      await screen.findByRole("button", { name: /Bob Beta/ });
    }
    fireEvent.click(screen.getByRole("button", { name: /Bob Beta/ }));
    await waitFor(() => expect(state.query).toHaveBeenCalledWith("resident_trust_transactions", { account_id: "trust-b" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "2.00" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Bob draft" } });
    await act(async () => mutation.resolve(ok([])));
    await act(async () => currentLedger.resolve(ok([transaction("b", "Bob receipt")])));
    expect(screen.getByText("Bob receipt")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("2.00");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Bob draft");
  });

  it("ignores a rejected ledger request after a different account has loaded", async () => {
    let reject!: (reason: Error) => void;
    const prior = new Promise((_resolve, r) => { reject = r; });
    state.query.mockImplementation((table, filters) => table === "resident_trust_transactions"
      ? filters.account_id === "trust-a" ? prior : ok([transaction("b", "Bob receipt")])
      : defaultQuery(table, filters));
    render(<CashPage />);
    await screen.findByText("Drawer A");
    fireEvent.click(screen.getByRole("tab", { name: "Resident trust" }));
    fireEvent.click(screen.getByRole("button", { name: /Alice Alpha/ }));
    await waitFor(() => expect(state.query).toHaveBeenCalledWith("resident_trust_transactions", { account_id: "trust-a" }));
    fireEvent.click(screen.getByRole("button", { name: /Bob Beta/ }));
    await screen.findByText("Bob receipt");
    await act(async () => reject(new Error("Alice private error")));
    expect(screen.queryByText("Alice private error")).not.toBeInTheDocument();
    expect(screen.getByText("Bob receipt")).toBeInTheDocument();
  });

  it("does not restart ledger requests when an outstanding mutation completes after unmount", async () => {
    const mutation = deferred();
    state.rpc.mockReturnValue(mutation.promise);
    const { unmount } = render(<CashPage />);
    await screen.findByText("Drawer A");
    fireEvent.click(screen.getByRole("tab", { name: "Resident trust" }));
    fireEvent.click(screen.getByRole("button", { name: /Alice Alpha/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "1.00" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Alice deposit" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
    const calls = state.query.mock.calls.length;
    unmount();
    await act(async () => mutation.resolve(ok([])));
    expect(state.query).toHaveBeenCalledTimes(calls);
  });
});
