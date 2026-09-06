import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({
  emitWorkflowEvent: vi.fn(),
  loadAdmissionCaseWorkflowContext: vi.fn(),
}));
vi.mock("@/lib/workflows/workflow-events", () => ({
  convertLeadOnMoveIn: vi.fn(),
  emitWorkflowEvent: workflow.emitWorkflowEvent,
  loadAdmissionCaseWorkflowContext: workflow.loadAdmissionCaseWorkflowContext,
  loadAdmissionRateTermCount: vi.fn(),
  loadForm1823State: vi.fn(),
}));
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { PATCH } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const sentinel = "column private_admission_note violates constraint admission_cases_policy";
const update = vi.fn();
const eq = vi.fn();
const actor = {
  id: "actor",
  organization_id: "org",
  admin: {
    from: vi.fn(() => {
      let eqCount = 0;
      const query = {
        update: vi.fn((payload: unknown) => {
          update(payload);
          return query;
        }),
        eq: vi.fn(() => {
          eq();
          eqCount += 1;
          return eqCount === 3 ? Promise.resolve({ error: { message: sentinel } }) : query;
        }),
      };
      return query;
    }),
  },
};

describe("admission update error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    workflow.loadAdmissionCaseWorkflowContext.mockResolvedValue({
      id: "admission",
      organization_id: "org",
      facility_id: "facility",
      resident_id: "resident",
      referral_lead_id: null,
      status: "draft",
      bed_id: null,
      target_move_in_date: null,
      financial_clearance_at: null,
      physician_orders_received_at: null,
    });
  });

  it("does not expose a persistence error or emit a success event", async () => {
    const response = await PATCH(
      new Request("https://local.test/admission", { method: "PATCH", body: JSON.stringify({ notes: "reviewed" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Admission changes could not be saved. Retry the update." });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(update).toHaveBeenCalledTimes(1);
    expect(workflow.emitWorkflowEvent).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "admin.workflows.admission.update",
      expect.objectContaining({ message: sentinel }),
      { action: "update", admissionCaseId: "admission", facilityId: "facility" },
    );
  });
});
