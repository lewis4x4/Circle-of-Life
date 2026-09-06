import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), facility: vi.fn(), verify: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mocks.auth, actorCanAccessFacility: mocks.facility }));
vi.mock("@/lib/supabase/witness-auth", () => ({ verifyWitnessCredentials: mocks.verify }));
import { POST } from "./route";
let originRole: string; let witnessRole: string;
beforeEach(() => {
  vi.clearAllMocks(); originRole = "med_tech"; witnessRole = "nurse";
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "pass", facility_id: "facility", organization_id: "org", administered_by: "actor", status: "pending" }, error: null });
  mocks.auth.mockImplementation(({ allowedRoles }) => allowedRoles.includes(originRole)
    ? { actor: { id: "actor", organization_id: "org", app_role: originRole, admin: { from: () => q, rpc: mocks.rpc } } }
    : { response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) });
  mocks.facility.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ data: { user: { id: "witness" } }, error: null });
  mocks.rpc.mockImplementation(() => ["nurse", "caregiver"].includes(witnessRole) ? { data: "signature", error: null } : { data: null, error: { message: "Invalid clinical witness" } });
});
const witness = () => POST(new NextRequest("http://local/witness", { method: "POST", body: JSON.stringify({ email: "nurse@example.test", password: "temporary-test-input" }) }), { params: Promise.resolve({ id: "pass" }) });
it("lets the actual med-tech pass owner request a nurse witness", async () => {
  const response = await witness(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, witnessSignatureId: "signature" });
  expect(mocks.rpc).toHaveBeenCalledWith("record_verified_med_pass_witness", { p_pass_id: "pass", p_actor_id: "actor", p_witness_id: "witness" });
});
it("retains caregiver witness eligibility", async () => {
  originRole = "nurse"; witnessRole = "caregiver"; expect((await witness()).status).toBe(200);
});
it("does not treat a med-tech identity as eligible incoming witness", async () => {
  originRole = "nurse"; witnessRole = "med_tech"; expect((await witness()).status).toBe(409);
});
