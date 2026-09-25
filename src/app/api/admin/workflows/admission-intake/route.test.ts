import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({ ensureForm1823Checklist: vi.fn(), emitWorkflowEvent: vi.fn() }));
vi.mock("@/lib/workflows/workflow-events", () => workflow);
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const rpc = vi.fn();
const actor = { id: "actor", organization_id: "org", admin: { rpc } };
const FACILITY = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const call = (body: unknown) => POST(new Request("https://local.test/intake", { method: "POST", body: JSON.stringify(body) }) as never);
const submit = { request_id: REQUEST, facility_id: FACILITY, referral_lead_id: LEAD, intent: "submit", target_move_in_date: "2099-01-05" };
const result = (over: Record<string, unknown> = {}) => ({
  resident_id: "resident", admission_case_id: "case", admission_case_status: "pending_clearance", referral_lead_id: LEAD,
  lead_status: "application_pending", outcome: "started", replayed: false, ...over,
});

describe("referral intake route (COL-333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  });

  it("runs the one transaction with only the fields given, and never writes a resident itself", async () => {
    rpc.mockResolvedValue({ data: result(), error: null });
    const response = await call({ ...submit, notes: "Daughter visiting" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admission_intake_start", {
      p_actor_id: "actor",
      p_payload: { ...submit, notes: "Daughter visiting" },
    });
    expect(workflow.ensureForm1823Checklist).toHaveBeenCalledTimes(1);
    expect(workflow.emitWorkflowEvent).toHaveBeenCalledWith(actor.admin, expect.objectContaining({
      event_type: "referral_admission_started", event_key: "referral-admission-started:case",
    }));
  });

  it("a replay or an already-started referral repeats no follow-up", async () => {
    rpc.mockResolvedValue({ data: result({ replayed: true }), error: null });
    await call(submit);
    rpc.mockResolvedValue({ data: result({ outcome: "already_started" }), error: null });
    await call(submit);
    expect(workflow.ensureForm1823Checklist).not.toHaveBeenCalled();
    expect(workflow.emitWorkflowEvent).not.toHaveBeenCalled();
  });

  it("a draft opens no Form 1823 checklist", async () => {
    rpc.mockResolvedValue({ data: result({ admission_case_status: "draft", outcome: "started_draft" }), error: null });
    await call({ ...submit, intent: "draft", target_move_in_date: undefined });
    expect(workflow.ensureForm1823Checklist).not.toHaveBeenCalled();
  });

  it("refuses unknown fields and a malformed request before the database", async () => {
    expect((await call({ ...submit, gender: "prefer_not_to_say" })).status).toBe(400);
    expect((await call({ ...submit, request_id: "not-a-uuid" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a facility the actor cannot reach", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    expect((await call(submit)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["This referral is closed (lost). Reopen it before starting an intake", 409],
    ["You no longer have access to start an intake at this facility", 403],
    ["A target move-in date of today or later is required", 400],
    ["Referral lead not found in facility", 400],
  ])("keeps the transaction's own words: %s", async (message, status) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await call(submit);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  it("logs but never returns an unexpected database message", async () => {
    const sentinel = "duplicate key value violates unique constraint admission_intake_receipts_request_id_key";
    rpc.mockResolvedValue({ data: null, error: { message: sentinel } });
    const response = await call(submit);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
    expect(logError).toHaveBeenCalled();
  });

  it("a failed follow-up is logged and the intake still stands", async () => {
    rpc.mockResolvedValue({ data: result(), error: null });
    workflow.ensureForm1823Checklist.mockRejectedValue(new Error("checklist down"));
    const response = await call(submit);
    expect(response.status).toBe(200);
    expect(logError).toHaveBeenCalledWith("admin.workflows.admission-intake", expect.any(Error), expect.objectContaining({ action: "follow_up" }));
  });

  it("says a reused request id in plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Idempotency key payload differs" } });
    const response = await call(submit);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This request was already sent with different details. Refresh the page and try again." });
  });
});
