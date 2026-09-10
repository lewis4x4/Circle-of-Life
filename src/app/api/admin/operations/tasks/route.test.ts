import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn(), actorCanViewOperations: vi.fn(), listActorAccessibleFacilityIds: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));
import { requireOperationsActor, actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds } from "@/lib/operations/auth";
import { GET } from "./route";

const sessionFrom = vi.fn();
const serviceFrom = vi.fn(() => { throw new Error("Service reads forbidden"); });
const actor = { id: "actor", organizationId: "org", appRole: "owner", currentActor: { client: { from: sessionFrom }, admin: { from: serviceFrom } } };
const row = { id: "permitted-task", organization_id: "org", facility_id: "site", template_id: null, template_name: "Authorized work", template_category: "maintenance", template_cadence_type: "daily", assigned_shift_date: "2026-09-09", assigned_shift: "day", assigned_to: null, assigned_role: "owner", status: "pending", due_at: "2026-09-09T20:00:00Z", priority: "normal", license_threatening: false, estimated_minutes: 10, current_escalation_level: 0, created_at: "2026-09-09T10:00:00Z", updated_at: "2026-09-09T10:00:00Z" };
function query(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error })),
  };
  return chain;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanViewOperations).mockReturnValue(true);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  vi.mocked(listActorAccessibleFacilityIds).mockResolvedValue(["site"]);
  sessionFrom.mockImplementation((table) => query(table === "operation_task_instances" ? [row] : [{ id: "site", name: "Site" }]));
});
describe("operations authorized reads", () => {
  it("builds list and counts only from session-visible tasks and reports classification scope", async () => {
    const response = await GET(new Request("https://haven.test/tasks?date=2026-09-09&view=day"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].id).toBe("permitted-task");
    expect(payload.pagination.total).toBe(1);
    expect(payload.coverage).toEqual({ scope: "currently_authorized_classified_tasks", legacy_classification_required: true, evidence_scope: "classified_only" });
    expect(serviceFrom).not.toHaveBeenCalled();
  });
  it("does not return zero counts or tasks when current facility authority fails", async () => {
    vi.mocked(listActorAccessibleFacilityIds).mockRejectedValue(new Error("revoked session"));
    const response = await GET(new Request("https://haven.test/tasks"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not verify facility access" });
    expect(sessionFrom).not.toHaveBeenCalled();
  });
  it("does not read an explicitly denied facility", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    const response = await GET(new Request("https://haven.test/tasks?facility_id=other-site"));
    expect(response.status).toBe(403);
    expect(sessionFrom).not.toHaveBeenCalled();
  });
  it("does not turn revoked task read authority into an empty successful summary", async () => {
    sessionFrom.mockReturnValue(query(null, { message: "session revoked" }));
    const response = await GET(new Request("https://haven.test/tasks"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load tasks" });
  });
  it("does not return previously loaded tasks if supporting details fail", async () => {
    sessionFrom.mockImplementation((table) => table === "operation_task_instances" ? query([row]) : query(null, { message: "authorization stale" }));
    const response = await GET(new Request("https://haven.test/tasks"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Failed to load task details" });
  });
});
