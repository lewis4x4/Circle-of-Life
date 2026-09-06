import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), verify: vi.fn(), facility: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "outgoing" } }, error: null }) } }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: mocks.admin }));
vi.mock("@/lib/supabase/witness-auth", () => ({ verifyWitnessCredentials: mocks.verify }));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({ serviceRoleUserHasFacilityAccess: mocks.facility }));
import { POST } from "./route";
let outgoingRole: string; let witnessRole: string;
beforeEach(() => {
  vi.clearAllMocks(); outgoingRole = "med_tech"; witnessRole = "nurse";
  mocks.facility.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ data: { user: { id: "incoming", email: "witness@example.test" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const q: Record<string, ReturnType<typeof vi.fn>> = {}; let target = "";
    for (const method of ["select", "is", "in"]) q[method] = vi.fn(() => q);
    q.eq = vi.fn((key, value) => { if (key === "id") target = value; return q; });
    q.maybeSingle = vi.fn(() => Promise.resolve({ data: { organization_id: "org", app_role: target === "outgoing" ? outgoingRole : witnessRole, full_name: "Witness" }, error: null }));
    q.then = vi.fn((resolve) => resolve({ data: table === "controlled_substance_counts" ? [{ id: "count", facility_id: "facility", organization_id: "org", outgoing_staff_id: "outgoing", incoming_staff_id: null }] : [], error: null }));
    return q;
  } });
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
