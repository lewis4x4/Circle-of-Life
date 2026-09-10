import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorCanAccessFacility, actorCanMutateTask, listActorAccessibleFacilityIds, type OperationsActor } from "./auth";

const rpc = vi.fn();
const serviceFrom = vi.fn(() => { throw new Error("service client forbidden"); });
const actor = {
  id: "current-person", organizationId: "org", appRole: "owner",
  currentActor: { client: { rpc }, admin: { from: serviceFrom } },
} as unknown as OperationsActor;
const task = { id: "task", organization_id: "org", facility_id: "site", assigned_to: "current-person" };

beforeEach(() => vi.clearAllMocks());
describe("operations current authority", () => {
  it("requires a current site grant even for an owner", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await actorCanAccessFacility(actor, "site")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("haven_operation_facility_access", { p_facility_id: "site" });
    expect(serviceFrom).not.toHaveBeenCalled();
  });
  it("does not trust assignment or owner role when current task authority denies access", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await actorCanMutateTask(actor, task)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("haven_operation_task_access", { p_task_id: "task" });
  });
  it("never submits foreign organization task identity", async () => {
    expect(await actorCanMutateTask(actor, { ...task, organization_id: "other" })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns only explicit current facility grants", async () => {
    rpc.mockResolvedValue({ data: ["site-a", "site-a"], error: null });
    expect(await listActorAccessibleFacilityIds(actor)).toEqual(["site-a"]);
  });
  it("does not represent failed authority retrieval as an empty facility list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "session revoked" } });
    await expect(listActorAccessibleFacilityIds(actor)).rejects.toThrow("Could not verify facility access");
    expect(await actorCanAccessFacility(actor, "site")).toBe(false);
    expect(await actorCanMutateTask(actor, task)).toBe(false);
  });
});
