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

import { PATCH } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const update = vi.fn();
function actorFor(appRole: string) {
  return {
    id: "actor",
    organization_id: "org",
    app_role: appRole,
    admin: {
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
const current = {
  id: "admission", organization_id: "org", facility_id: "facility", resident_id: "resident", referral_lead_id: null,
  status: "bed_reserved", bed_id: "bed", target_move_in_date: "2026-10-01",
  financial_clearance_at: "2026-09-20T12:00:00Z", physician_orders_received_at: "2026-09-20T12:00:00Z",
};

async function patch(body: unknown) {
  const response = await PATCH(
    new Request("https://local.test/admission", { method: "PATCH", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: "admission" }) },
  );
  return { status: response.status, payload: await response.json() };
}

describe("COL-575 Medicaid review override on the admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor: actorFor("facility_admin") } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    workflow.loadAdmissionCaseWorkflowContext.mockResolvedValue(current);
  });

  it("records a Facility Executive's override with who and when; the arrival readiness then clears the review", async () => {
    const { status } = await patch({ medicaid_gate_override_reason: "  Family paying privately until decided  " });
    expect(status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      medicaid_gate_override_reason: "Family paying privately until decided",
      medicaid_gate_override_by: "actor",
      medicaid_gate_override_at: expect.any(String),
    }));
    expect(workflow.emitWorkflowEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      event_type: "admission_case_updated",
      payload_json: { fields: ["medicaid_gate_override_reason"] },
    }));
  });

  it("refuses the override from roles that are not Facility Executives", async () => {
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor: actorFor("coordinator") } as never);
    const { status } = await patch({ medicaid_gate_override_reason: "Please let them in" });
    expect(status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("never records a move-in, even with an override: that is the approved arrival's job", async () => {
    const { status } = await patch({ status: "move_in", medicaid_gate_override_reason: "Override" });
    expect(status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
});
