import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), requireActor: vi.fn(), revalidateActor: vi.fn(), verify: vi.fn(), facility: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: mocks.requireActor, revalidateCurrentApiActor: mocks.revalidateActor }));
vi.mock("@/lib/supabase/witness-auth", () => ({ verifyWitnessCredentials: mocks.verify }));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({ serviceRoleUserHasFacilityAccess: mocks.facility }));
import { POST } from "./route";
let outgoingRole: string; let witnessRole: string; let countRows: Record<string, unknown>[]; let lastCountQuery: Record<string, ReturnType<typeof vi.fn>> | null;
beforeEach(() => {
  vi.clearAllMocks(); outgoingRole = "med_tech"; witnessRole = "nurse";
  countRows = [{ id: "count", facility_id: "facility", organization_id: "org", outgoing_staff_id: "outgoing", incoming_staff_id: null }];
  lastCountQuery = null;
  mocks.facility.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ data: { user: { id: "incoming", email: "witness@example.test" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const q: Record<string, ReturnType<typeof vi.fn>> = {}; let target = "";
    for (const method of ["select", "is", "in"]) q[method] = vi.fn(() => q);
    q.eq = vi.fn((key, value) => { if (key === "id") target = value; return q; });
    q.maybeSingle = vi.fn(() => Promise.resolve({ data: { organization_id: "org", app_role: target === "outgoing" ? outgoingRole : witnessRole, full_name: "Witness" }, error: null }));
    q.then = vi.fn((resolve) => resolve({ data: table === "controlled_substance_counts" ? countRows : [], error: null }));
    if (table === "controlled_substance_counts") lastCountQuery = q;
    return q;
  } });
  mocks.requireActor.mockImplementation(async ({ allowedRoles }: { allowedRoles?: readonly string[] }) =>
    allowedRoles?.includes(outgoingRole)
      ? { actor: { id: "outgoing", organizationId: "org", appRole: outgoingRole, admin: mocks.admin() } }
      : { response: Response.json({ error: "Insufficient permissions" }, { status: 403 }) });
  mocks.revalidateActor.mockImplementation(async (actor) => ({ actor }));
});
const sign = () => POST(new Request("http://local/verify", { method: "POST", body: JSON.stringify({ countId: "count", facilityId: "facility", email: "witness@example.test", password: "temporary-test-input" }) }));
it.each(["med_tech", "nurse", "caregiver"])("allows %s to originate a count with an authorized nurse witness", async (role) => {
  outgoingRole = role; const response = await sign(); expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("preserves caregiver witness eligibility", async () => {
  witnessRole = "caregiver"; expect((await sign()).status).toBe(200);
});
it.each(["med_tech", "owner", "manager", "family"])("does not authorize %s as the incoming witness", async (role) => {
  witnessRole = role; expect((await sign()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["owner", "manager", "family"])("does not let %s perform the outgoing count", async (role) => {
  outgoingRole = role; expect((await sign()).status).toBe(403); expect(mocks.verify).not.toHaveBeenCalled();
});
it.each(["another organization", "another facility"])("does not verify a witness for a count in %s", async () => {
  countRows = [];
  const response = await sign();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ verified: false, error: "Count record(s) not found" });
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(lastCountQuery?.eq).toHaveBeenCalledWith("organization_id", "org");
  expect(lastCountQuery?.eq).toHaveBeenCalledWith("facility_id", "facility");
});
