import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({
  emitWorkflowEvent: vi.fn(),
  loadAdmissionCaseWorkflowContext: vi.fn(),
  loadAdmissionRateTermCount: vi.fn(),
  loadForm1823State: vi.fn(),
}));
vi.mock("@/lib/workflows/workflow-events", () => workflow);
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

import { PATCH } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const update = vi.fn();
function actorFor(appRole: string) {
  return {
    id: "actor",
    organization_id: "org",
    app_role: appRole,
    admin: {
      rpc,
      from: vi.fn(() => {
        const query = {
          update: vi.fn((payload: unknown) => { update(payload); return query; }),
          eq: vi.fn(() => query),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
        return query;
      }),
    },
  };
}
const ready = {
  id: "admission",
  organization_id: "org",
  facility_id: "facility",
  resident_id: "resident",
  referral_lead_id: null,
  status: "bed_reserved",
  bed_id: "bed",
  target_move_in_date: "2026-10-01",
  financial_clearance_at: "2026-09-20T12:00:00Z",
  physician_orders_received_at: "2026-09-20T12:00:00Z",
  anticipated_payer_source: "medicaid_pending",
};
const notQualified = { applies: true, satisfied: false, overridden: false, result: "not_qualified_now", reason: "Medicaid preliminary review (answers show: does not qualify now)" };

async function patch(body: unknown) {
  const response = await PATCH(
    new Request("https://local.test/admission", { method: "PATCH", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: "admission" }) },
  );
  return { status: response.status, payload: await response.json() };
}

describe("COL-575 Medicaid move-in gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor: actorFor("facility_admin") } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    workflow.loadAdmissionCaseWorkflowContext.mockResolvedValue(ready);
    workflow.loadAdmissionRateTermCount.mockResolvedValue(1);
    workflow.loadForm1823State.mockResolvedValue({ isSatisfied: true });
    rpc.mockResolvedValue({ data: notQualified, error: null });
  });

  it("blocks move-in when the Medicaid review does not show likely to qualify", async () => {
    const { status, payload } = await patch({ status: "move_in" });
    expect(status).toBe(409);
    expect(payload.blocked_by).toEqual([notQualified.reason]);
    expect(rpc).toHaveBeenCalledWith("benefits_move_in_gate", { p_admission_case_id: "admission", p_anticipated_payer_source: "medicaid_pending" });
    expect(update).not.toHaveBeenCalled();
    expect(workflow.emitWorkflowEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: "admission_move_in_blocked" }));
  });

  it("evaluates the payer being set in the same change", async () => {
    rpc.mockResolvedValue({ data: { ...notQualified, applies: false, satisfied: true, reason: null }, error: null });
    const { status } = await patch({ status: "move_in", anticipated_payer_source: "private_pay" });
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("benefits_move_in_gate", { p_admission_case_id: "admission", p_anticipated_payer_source: "private_pay" });
  });

  it("lets a Facility Executive override with a reason and records who and when", async () => {
    const { status } = await patch({ status: "move_in", medicaid_gate_override_reason: "  Family paying privately until decided  " });
    expect(status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: "move_in",
      medicaid_gate_override_reason: "Family paying privately until decided",
      medicaid_gate_override_by: "actor",
      medicaid_gate_override_at: expect.any(String),
    }));
    expect(workflow.emitWorkflowEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      event_type: "admission_status_changed",
      payload_json: expect.objectContaining({ medicaid_gate_overridden: true }),
    }));
  });

  it("refuses the override from roles that are not Facility Executives", async () => {
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor: actorFor("coordinator") } as never);
    const { status } = await patch({ status: "move_in", medicaid_gate_override_reason: "Please let them in" });
    expect(status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("fails closed when the gate cannot be checked", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { status } = await patch({ status: "move_in" });
    expect(status).toBe(503);
    expect(update).not.toHaveBeenCalled();
  });
});
