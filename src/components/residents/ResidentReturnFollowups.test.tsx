import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResidentReturnFollowups } from "./ResidentReturnFollowups";

const mocks = vi.hoisted(() => ({
  role: "nurse", pending: true, rpcError: false, readError: false, duplicateForms: false, legacy: null as string | null,
  result: { status: "completed", outcome: "completed", code: "updated" },
  rpc: vi.fn(),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: "actor" }, appRole: mocks.role, loading: false }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: async (name: string, args: unknown) => {
    mocks.rpc(name, args);
    if (mocks.rpcError) return { data: null, error: { message: "Connection lost" } };
    if (mocks.result.status === "completed") mocks.pending = false;
    return { data: mocks.result, error: null };
  },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query, gte: () => query, order: () => query,
      maybeSingle: async () => ({ data: { hold_case_manager_notified_at: mocks.legacy }, error: null }),
      range: async (start: number) => ({
        data: start > 0 ? [] : table === "resident_return_followups" ? (mocks.pending ? [{ id: "followup", status: "pending", created_at: "2026-09-08T12:00:00Z", result_code: null }] : []) : (mocks.duplicateForms ? ["form", "form-two"] : ["form"]).map((id) => ({ id, physician_name: "Dr Example", exam_date: "2026-09-08", status: "received", updated_at: "2026-09-08T13:00:00Z" })),
        error: mocks.readError ? { message: "Denied" } : null,
      }),
    };
    return query;
  },
}) }));
beforeEach(() => { mocks.role = "nurse"; mocks.pending = true; mocks.rpcError = false; mocks.readError = false; mocks.duplicateForms = false; mocks.legacy = null; mocks.result = { status: "completed", outcome: "completed", code: "updated" }; vi.clearAllMocks(); });
afterEach(cleanup);

describe("durable return follow-up", () => {
  it("keeps failed work visible after remount and completes an explicit retry", async () => {
    mocks.rpcError = true;
    const first = render(<ResidentReturnFollowups residentId="resident" />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry document update" }));
    expect(await screen.findByText(/Document update was not confirmed/)).toBeInTheDocument();
    first.unmount();
    mocks.rpcError = false;
    render(<ResidentReturnFollowups residentId="resident" />);
    expect(await screen.findByText(/Presence is saved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry document update" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Return follow-up" })).not.toBeInTheDocument());
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not present a missing document as a completed renewal", async () => {
    mocks.result = { status: "pending", outcome: "needs_review", code: "no_eligible_forms" };
    render(<ResidentReturnFollowups residentId="resident" />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry document update" }));
    expect(await screen.findByText(/No eligible Form 1823 was available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record separate review" })).toBeInTheDocument();
  });

  it("requires an explicit report choice and review evidence, retaining them on uncertain save", async () => {
    render(<ResidentReturnFollowups residentId="resident" />);
    await userEvent.click(await screen.findByRole("button", { name: "Record separate review" }));
    const select = await screen.findByRole("combobox", { name: "Reviewed physician report" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("button", { name: "Record completed review" })).toBeDisabled();
    await userEvent.selectOptions(select, "form");
    await userEvent.type(screen.getByRole("textbox", { name: "Review evidence" }), "Reviewed updated report with clinician.");
    mocks.rpcError = true;
    await userEvent.click(screen.getByRole("button", { name: "Record completed review" }));
    expect(await screen.findByText(/Review was not confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Review evidence" })).toHaveValue("Reviewed updated report with clinician.");
    expect(mocks.rpc).toHaveBeenCalledWith("haven_resolve_return_document_followup", {
      p_followup_id: "followup", p_form_id: "form", p_form_updated_at: "2026-09-08T13:00:00Z", p_review_note: "Reviewed updated report with clinician.",
    });
  });

  it("shows legacy time without fabricating supporting communication evidence", async () => {
    mocks.pending = false; mocks.legacy = "2026-09-07T12:00:00Z";
    render(<ResidentReturnFollowups residentId="resident" />);
    expect(await screen.findByText(/Supporting communication evidence is unavailable/)).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps caregiver follow-up visible without clinical review actions", async () => {
    mocks.role = "caregiver";
    render(<ResidentReturnFollowups residentId="resident" />);
    expect(await screen.findByText(/A nurse or administrator can review/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry document update" })).not.toBeInTheDocument();
  });

  it("does not turn a denied load into an empty all-clear state", async () => {
    mocks.readError = true;
    render(<ResidentReturnFollowups residentId="resident" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByRole("button", { name: "Refresh follow-up" })).toBeInTheDocument();
  });
});


it("distinguishes reports with identical clinical metadata and shows the selected reference", async () => {
  mocks.duplicateForms = true;
  render(<ResidentReturnFollowups residentId="resident" />);
  await userEvent.click(await screen.findByRole("button", { name: "Record separate review" }));
  expect(await screen.findByRole("option", { name: /Report 1 · Dr Example/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Report 2 · Dr Example/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox"), "form-two");
  expect(screen.getByText(/Report reference: form-two/)).toBeInTheDocument();
});
