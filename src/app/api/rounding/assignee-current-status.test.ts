import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  accessibleFacilities: vi.fn(),
  facilityAccess: vi.fn(),
  managerRole: vi.fn(),
  revalidate: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/rounding/auth", () => ({
  getRoundingRequestContext: mocks.getContext,
  getAccessibleRoundingFacilityIds: mocks.accessibleFacilities,
  assertRoundingFacilityAccess: mocks.facilityAccess,
  isRoundingManagerRole: mocks.managerRole,
  revalidateRoundingRequestContext: mocks.revalidate,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { PATCH as updateIntegrityFlag } from "./integrity-flags/[id]/route";
import { POST as reassignTask } from "./tasks/[id]/reassign/route";

function query(data: unknown) {
  const value: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "is"]) value[method] = vi.fn(() => value);
  value.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return value;
}

function context(resourceTable: string, resource: Record<string, unknown>) {
  const resourceQuery = query(resource);
  const staffQuery = query(null);
  const rpc = vi.fn();
  return {
    value: {
      actor: { client: {} },
      admin: {
        from: vi.fn((table: string) => table === resourceTable ? resourceQuery : staffQuery),
        rpc,
      },
      userId: "manager-1",
      organizationId: "org-1",
      appRole: "owner",
      currentStaffId: "manager-staff",
      sessionId: "session-1",
      authClaimVersion: 3,
    },
    staffQuery,
    rpc,
  };
}

describe("rounding assignee current employment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessibleFacilities.mockResolvedValue(["facility-1"]);
    mocks.facilityAccess.mockResolvedValue(true);
    mocks.managerRole.mockReturnValue(true);
  });

  it("rejects a terminated task assignee before the reassign RPC", async () => {
    const current = context("resident_observation_tasks", {
      id: "task-1",
      organization_id: "org-1",
      entity_id: "entity-1",
      facility_id: "facility-1",
      resident_id: "resident-1",
      assigned_staff_id: "old-staff",
      shift_assignment_id: null,
      status: "due_now",
      completed_log_id: null,
    });
    mocks.getContext.mockResolvedValue({ context: current.value });

    const response = await reassignTask(
      new Request("https://haven.test/api/rounding/tasks/task-1/reassign", {
        method: "POST",
        body: JSON.stringify({ newStaffId: "terminated-staff", reason: "Coverage changed" }),
      }),
      { params: Promise.resolve({ id: "task-1" }) },
    );

    expect(response.status).toBe(404);
    expect(current.staffQuery.eq).toHaveBeenCalledWith("employment_status", "active");
    expect(current.rpc).not.toHaveBeenCalled();
  });

  it("rejects completed task reassignment before assignee lookup or RPC", async () => {
    const current = context("resident_observation_tasks", {
      id: "task-complete",
      organization_id: "org-1",
      entity_id: "entity-1",
      facility_id: "facility-1",
      resident_id: "resident-1",
      assigned_staff_id: "old-staff",
      shift_assignment_id: null,
      status: "completed_on_time",
      completed_log_id: "log-1",
    });
    mocks.getContext.mockResolvedValue({ context: current.value });

    const response = await reassignTask(
      new Request("https://haven.test/api/rounding/tasks/task-complete/reassign", {
        method: "POST",
        body: JSON.stringify({ newStaffId: "staff-2", reason: "Invalid terminal attempt" }),
      }),
      { params: Promise.resolve({ id: "task-complete" }) },
    );

    expect(response.status).toBe(409);
    expect(current.staffQuery.select).not.toHaveBeenCalled();
    expect(current.rpc).not.toHaveBeenCalled();
  });

  it("rejects a suspended integrity assignee before the update RPC", async () => {
    const current = context("resident_observation_integrity_flags", {
      id: "flag-1",
      organization_id: "org-1",
      facility_id: "facility-1",
      status: "open",
    });
    mocks.getContext.mockResolvedValue({ context: current.value });

    const response = await updateIntegrityFlag(
      new Request("https://haven.test/api/rounding/integrity-flags/flag-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "assign", assignedStaffId: "suspended-staff" }),
      }),
      { params: Promise.resolve({ id: "flag-1" }) },
    );

    expect(response.status).toBe(404);
    expect(current.staffQuery.eq).toHaveBeenCalledWith("employment_status", "active");
    expect(current.rpc).not.toHaveBeenCalled();
  });
});
