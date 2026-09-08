import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralNextActionPanel } from "./ReferralNextActionPanel";
import { recoveryKey, saveRecoveryIdentifier, readRecoveryIdentifiers, type NextActionView } from "@/lib/referrals/next-actions";
const mocks = vi.hoisted(() => ({ role: "nurse", userId: "actor", action: null as NextActionView | null, receipt: null as unknown, fail: false, failCode: null as string | null, pages: false, pending: null as Promise<unknown> | null, duplicateNames: false, supersedeHistory: false, receipts: {} as Record<string, unknown>, rpc: vi.fn(), command: vi.fn() }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: mocks.userId }, appRole: mocks.role, loading: false }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  mocks.rpc(name, args);
  if (name === "haven_get_referral_next_action_receipt") return { data: Object.hasOwn(mocks.receipts, String(args.p_request_id)) ? mocks.receipts[String(args.p_request_id)] : mocks.receipt, error: null };
  if (name === "haven_list_referral_next_actions") return { data: { items: mocks.action ? [mocks.action] : [], next_cursor: null }, error: null };
  if (name === "haven_list_referral_next_action_events") return { data: { items: mocks.supersedeHistory ? [{ id: "replaced", command: "supersede", actor_name: "Alex Example", actor_id: "actor", created_at: "2026-09-01T12:00:00Z", before_state: fixture(), after_state: fixture({ status: "superseded", superseded_by_action_id: "replacement-action" }), payload: { replacement: { action_text: "Replacement recorded work", owner_id: "replacement-owner", backup_id: null, due_at: "2026-09-09T16:00:00Z", waiting_condition: "New dependency", dependency_text: null } } }] : mocks.pages && args.p_before_id ? [{ id: "older", command: "update", before_state: fixture({ owner_id: "previous-owner", due_at: "2026-09-01T12:00:00Z", waiting_condition: "Old dependency" }), actor_name: "Alex Example", created_at: "2026-09-01T12:00:00Z", after_state: fixture({ action_text: "Older work" }), payload: {} }] : [], next_cursor: mocks.pages && !args.p_before_id ? { created_at: "2026-09-02T12:00:00Z", id: "cursor" } : null }, error: null };
  if (name === "haven_list_referral_next_action_assignees") return { data: { items: [{ id: "actor", full_name: "Alex Example", app_role: "nurse" }, { id: "backup", full_name: mocks.duplicateNames ? "Alex Example" : "Blair Example", app_role: "nurse" }], next_cursor: null }, error: null };
  mocks.command(args);
  if (mocks.pending) return await mocks.pending;
  if (mocks.fail) return { data: null, error: { message: "stale", code: mocks.failCode } };
  mocks.action = { ...fixture(), ...(args.p_payload as object), version: (mocks.action?.version ?? 0) + 1, owner_acknowledged: args.p_command === "acknowledge", backup_accepted: args.p_command === "accept_backup", status: args.p_command === "complete" ? "completed" : "open" };
  return { data: { request_id: args.p_request_id, action: mocks.action }, error: null };
} }) }));
const scope = { user_id: "actor", organization_id: "org", facility_id: "facility", lead_id: "lead" };
function fixture(overrides: Partial<NextActionView> = {}): NextActionView { return { id: "action", organization_id: "org", facility_id: "facility", lead_id: "lead", lead_name: "Example Lead", action_text: "Confirm requested visit", owner_id: "actor", owner_name: "Alex Example", backup_id: "backup", backup_name: "Blair Example", due_at: null, waiting_condition: "Family reply", dependency_text: null, status: "open", version: 3, terms_version: 1, owner_eligible: true, backup_eligible: true, owner_acknowledged: false, backup_accepted: false, can_manage: true, can_acknowledge: true, can_accept_backup: false, can_complete: true, owner_acknowledged_at: null, owner_acknowledged_version: null, backup_accepted_at: null, backup_accepted_version: null, completed_at: null, completed_by: null, completion_evidence: null, superseded_by_action_id: null, created_at: "2026-09-08T12:00:00Z", created_by: "actor", updated_at: "2026-09-08T12:00:00Z", ...overrides }; }
function panel() { return render(<ReferralNextActionPanel leadId="lead" facilityId="facility" organizationId="org" />); }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mocks.action = null; mocks.receipt = null; mocks.fail = false; mocks.failCode = null; mocks.pages = false; mocks.pending = null; mocks.role = "nurse"; mocks.userId = "actor"; mocks.duplicateNames = false; mocks.supersedeHistory = false; mocks.receipts = {}; });
afterEach(cleanup);
describe("accountable referral next action", () => {
  it("requires explicit due or waiting terms and does not silently acknowledge an assignment", async () => {
    panel(); await userEvent.click(await screen.findByRole("button", { name: "Add next action" }));
    await userEvent.type(screen.getByLabelText("Action", { exact: true }), "Call contact");
    await userEvent.selectOptions(screen.getByLabelText("Owner", { exact: true }), "actor");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(mocks.command).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Waiting condition"), "Requested callback");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await screen.findByText("Action saved.");
    expect(mocks.command.mock.calls[0][0]).toMatchObject({ p_expected_version: 0, p_command: "create", p_payload: { waiting_condition: "Requested callback", due_at: null } });
    expect(screen.getByText(/Owner: Alex Example/)).toHaveTextContent("Not acknowledged");
  });
  it("acknowledges only through the server capability and keeps completion evidence mandatory", async () => {
    mocks.action = fixture(); panel();
    await userEvent.click(await screen.findByRole("button", { name: "Acknowledge my ownership" }));
    await screen.findByText("Action saved.");
    expect(mocks.command.mock.calls[0][0]).toMatchObject({ p_command: "acknowledge", p_expected_version: 3 });
    expect(screen.getByRole("button", { name: "Complete action" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Completion evidence"), "Contact confirmed appointment");
    await userEvent.click(screen.getByRole("button", { name: "Complete action" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][0]).toMatchObject({ p_command: "complete", p_payload: { completion_evidence: "Contact confirmed appointment" } });
  });
  it("retains a stale draft and its old version through refresh, with a fresh UUID per attempt", async () => {
    mocks.action = fixture(); mocks.fail = true; panel();
    await userEvent.click(await screen.findByRole("button", { name: "Edit or reassign" }));
    await userEvent.clear(screen.getByLabelText("Action", { exact: true }));
    await userEvent.type(screen.getByLabelText("Action", { exact: true }), "Preserved draft");
    await userEvent.type(screen.getByLabelText("Reason for change"), "Contact requested change");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await screen.findByRole("alert");
    const first = mocks.command.mock.calls[0][0];
    expect(sessionStorage.getItem(recoveryKey(scope))).not.toContain("Preserved draft");
    mocks.action = fixture({ version: 9, action_text: "Concurrent edit" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh action" }));
    await screen.findByText("Concurrent edit");
    expect(screen.getByLabelText("Action", { exact: true })).toHaveValue("Preserved draft");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[1][0].p_expected_version).toBe(3);
    expect(mocks.command.mock.calls[1][0].p_request_id).not.toBe(first.p_request_id);
  });
  it.each([true, false])("recovers an uncertain result on reload: receipt present %s", async (present) => {
    saveRecoveryIdentifier(sessionStorage, scope, "request", "action");
    mocks.receipt = present ? { request_id: "request", action: fixture() } : null;
    mocks.action = fixture(); panel();
    await screen.findByText(present ? /Previous save confirmed/ : /Save not confirmed/);
    await screen.findByText("Confirm requested visit");
    expect(mocks.command).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(recoveryKey(scope)) === null).toBe(present);
  });
  it("shows read-only work without requesting writer-only eligible people", async () => {
    mocks.role = "caregiver"; mocks.action = fixture({ can_manage: false, can_acknowledge: false, can_accept_backup: false, can_complete: false }); panel();
    await screen.findByText("Confirm requested visit");
    expect(screen.queryByRole("button", { name: "Edit or reassign" })).not.toBeInTheDocument();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "haven_list_referral_next_action_assignees")).toBe(false);
  });
  it("keeps accepted backup coverage visible when owner is unavailable", async () => {
    mocks.action = fixture({ owner_eligible: false, backup_accepted: true, can_acknowledge: false }); panel();
    expect(await screen.findByText(/Owner: Alex/)).toHaveTextContent("Access unavailable");
    expect(screen.getByText(/Backup: Blair/)).toHaveTextContent("Coverage accepted");
  });
  it("accepts backup coverage through its own command without acknowledging the owner", async () => {
    mocks.action = fixture({ can_acknowledge: false, can_accept_backup: true }); panel();
    await userEvent.click(await screen.findByRole("button", { name: "Accept backup coverage" }));
    await screen.findByText("Action saved.");
    expect(mocks.command.mock.calls[0][0]).toMatchObject({ p_command: "accept_backup", p_payload: { acceptance_note: null } });
    expect(screen.getByText(/Owner: Alex/)).toHaveTextContent("Not acknowledged");
  });
  it("ignores a command response after the actor scope changes and serializes double clicks", async () => {
    let resolve!: (value: unknown) => void;
    mocks.pending = new Promise((done) => { resolve = done; });
    mocks.action = fixture(); const rendered = panel();
    await userEvent.dblClick(await screen.findByRole("button", { name: "Acknowledge my ownership" }));
    expect(mocks.command).toHaveBeenCalledTimes(1);
    mocks.userId = "other"; mocks.action = fixture({ action_text: "Other actor view", can_acknowledge: false });
    rendered.rerender(<ReferralNextActionPanel leadId="lead" facilityId="facility" organizationId="org" />);
    await screen.findByText("Other actor view");
    resolve({ data: { request_id: "request", action: fixture({ action_text: "Old scope result" }) }, error: null });
    await waitFor(() => expect(screen.queryByText("Old scope result")).not.toBeInTheDocument());
    expect(screen.queryByText("Action saved.")).not.toBeInTheDocument();
  });

  it("requires replacement evidence and sends a bounded replacement payload", async () => {
    mocks.action = fixture(); panel();
    await userEvent.click(await screen.findByRole("button", { name: "Replace action" }));
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(mocks.command).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Replacement evidence"), "Different visit requested");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command.mock.calls[0][0]).toMatchObject({ p_action_id: "action", p_expected_version: 3, p_command: "supersede", p_payload: { replacement: { action_text: "Confirm requested visit" }, supersede_evidence: "Different visit requested" } });
  });
  it("loads older history with the returned stable cursor", async () => {
    mocks.pages = true; panel();
    await screen.findByRole("button", { name: "Add next action" });
    await userEvent.click(screen.getByText("Action history"));
    await userEvent.click(screen.getByRole("button", { name: "Load older history" }));
    await screen.findByText("Older work", { selector: "p" });
    await userEvent.click(screen.getByText("View recorded terms"));
    expect(screen.getByText("Person · ID previous-owner")).toBeInTheDocument();
    expect(screen.getByText("Old dependency")).toBeInTheDocument();
    expect(screen.getByText("Sep 1, 2026, 8:00 AM EDT")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("haven_list_referral_next_action_events", expect.objectContaining({ p_before_id: "cursor", p_before_created_at: "2026-09-02T12:00:00Z" }));
    expect(screen.queryByRole("button", { name: "Load older history" })).not.toBeInTheDocument();
  });

  it("keeps completion evidence bound to its original version through acknowledgment and refresh", async () => {
    mocks.action = fixture(); panel();
    await userEvent.type(await screen.findByLabelText("Completion evidence"), "Evidence for original work");
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge my ownership" }));
    await screen.findByText("Action saved.");
    expect(screen.getByLabelText("Completion evidence")).toHaveValue("Evidence for original work");
    mocks.action = fixture({ version: 9, action_text: "Changed work" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh action" }));
    await screen.findByText("Changed work");
    mocks.fail = true;
    await userEvent.click(screen.getByRole("button", { name: "Complete action" }));
    await screen.findByRole("alert");
    expect(mocks.command.mock.calls.at(-1)?.[0]).toMatchObject({ p_command: "complete", p_expected_version: 3 });
    expect(screen.getByLabelText("Completion evidence")).toHaveValue("Evidence for original work");
    await userEvent.click(screen.getByRole("button", { name: "Discard completion draft" }));
    expect(screen.getByLabelText("Completion evidence")).toHaveValue("");
  });
  it("distinguishes same-name assignees and shows a stable identity for blank names", async () => {
    mocks.duplicateNames = true; mocks.action = fixture({ owner_name: " " }); panel();
    expect(await screen.findByText(/Owner: Person ID actor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit or reassign" }));
    expect(screen.getAllByRole("option", { name: "Alex Example · nurse · ID actor" })).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: "Alex Example · nurse · ID backup" })).toHaveLength(2);
  });
  it("recovers a late first commit after a second uncertain attempt without losing either identifier", async () => {
    mocks.action = fixture(); mocks.fail = true;
    const view = panel();
    await userEvent.click(await screen.findByRole("button", { name: "Acknowledge my ownership" }));
    await screen.findByRole("alert");
    const first = mocks.command.mock.calls[0][0].p_request_id;
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge my ownership" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    const second = mocks.command.mock.calls[1][0].p_request_id;
    expect(readRecoveryIdentifiers(sessionStorage, scope).map((entry) => entry.request_id)).toEqual([first, second]);
    mocks.receipts[first] = { request_id: first, action: fixture({ version: 4 }) };
    mocks.action = fixture({ version: 4 });
    view.unmount(); panel();
    await screen.findByText(/Previous save confirmed; Save not confirmed for 1/);
    expect(readRecoveryIdentifiers(sessionStorage, scope).map((entry) => entry.request_id)).toEqual([second]);
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });

  it("retires a definitely rejected request while retaining the draft and explaining the conflict", async () => {
    mocks.action = fixture(); mocks.fail = true; mocks.failCode = "PT409"; panel();
    await userEvent.type(await screen.findByLabelText("Completion evidence"), "Evidence preserved after conflict");
    await userEvent.click(screen.getByRole("button", { name: "Complete action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The action changed");
    expect(screen.getByLabelText("Completion evidence")).toHaveValue("Evidence preserved after conflict");
    expect(readRecoveryIdentifiers(sessionStorage, scope)).toEqual([]);
  });

  it.each(["2026-11-01T06:30:00.000Z", "2026-09-08T13:00:45.000Z"])("preserves exact due instant %s when editing other terms", async (dueAt) => {
    mocks.action = fixture({ due_at: dueAt }); panel();
    await userEvent.click(await screen.findByRole("button", { name: "Edit or reassign" }));
    await userEvent.type(screen.getByLabelText("Action", { exact: true }), " with context");
    await userEvent.type(screen.getByLabelText("Reason for change"), "Clarify work");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await screen.findByText("Action saved.");
    expect(mocks.command.mock.calls[0][0].p_payload.due_at).toBe(dueAt);
  });
  it("rejects a newly entered nonexistent spring transition time instead of shifting the deadline", async () => {
    mocks.action = fixture(); panel();
    await userEvent.click(await screen.findByRole("button", { name: "Edit or reassign" }));
    await userEvent.type(screen.getByLabelText(/Due date and time/), "2026-03-08T02:30");
    await userEvent.type(screen.getByLabelText("Reason for change"), "Set explicit deadline");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("local time does not exist");
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("keeps replacement terms visible in history after the replacement is no longer active", async () => {
    mocks.supersedeHistory = true; panel();
    await screen.findByRole("button", { name: "Add next action" });
    await userEvent.click(screen.getByText("Action history"));
    await userEvent.click(screen.getByText("View recorded terms"));
    expect(screen.getByText("Replacement recorded work")).toBeInTheDocument();
    expect(screen.getByText("Person · ID replacement-owner")).toBeInTheDocument();
    expect(screen.getByText("Action reference: replacement-action")).toBeInTheDocument();
    expect(screen.getByText("Sep 9, 2026, 12:00 PM EDT")).toBeInTheDocument();
  });

});
