import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const state = vi.hoisted(() => ({ rpc: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }), usePathname: () => "/admin/finance/journal-entries/new" }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ organizationId: "synthetic-org", appRole: "owner" }) }));
vi.mock("@/lib/supabase/client", () => {
  const client = {
    rpc: state.rpc,
    from: (table: string) => {
      const data = table === "entities" ? [{ id: "entity", name: "Synthetic entity" }]
        : table === "gl_accounts" ? [{ id: "cash", code: "1000", name: "Cash" }, { id: "clearing", code: "2000", name: "Clearing" }] : [];
      const builder = {
        select: () => builder, eq: () => builder, is: () => builder, order: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { createClient: () => client };
});
async function fillValidPair() {
  render(<Page />);
  await waitFor(() => expect(screen.getAllByRole("option", { name: "1000 — Cash" })).toHaveLength(2));
  fireEvent.change(screen.getByRole("combobox", { name: "Account, line 1" }), { target: { value: "cash" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Debit dollars, line 1" }), { target: { value: "0.29" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Account, line 2" }), { target: { value: "clearing" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Credit dollars, line 2" }), { target: { value: "0.29" } });
}
describe("HFA-036 journal form submission", () => {
  beforeEach(() => { state.rpc.mockReset().mockResolvedValue({ data: "saved-draft", error: null }); state.push.mockReset(); });
  afterEach(cleanup);

  it("sends exact cents for a valid draft", async () => {
    await fillValidPair();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("save_journal_draft", expect.objectContaining({ p_lines: [
      { gl_account_id: "cash", debit_cents: 29, credit_cents: 0, line_number: 1 },
      { gl_account_id: "clearing", debit_cents: 0, credit_cents: 29, line_number: 2 },
    ] })));
  });

  it("does not discard an invalid third line and save only the balanced pair", async () => {
    await fillValidPair();
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Account, line 3" }), { target: { value: "cash" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Debit dollars, line 3" }), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("line 3");
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Debit dollars, line 3" }), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
    expect(state.rpc.mock.calls[0][1].p_lines).toHaveLength(3);
    expect(state.rpc.mock.calls[0][1].p_lines[2]).toEqual({ gl_account_id: "cash", debit_cents: 100, credit_cents: 0, line_number: 3 });
  });
});
