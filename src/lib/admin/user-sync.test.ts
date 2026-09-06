import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), role: vi.fn(), disable: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mocks.auth, actorCanAccessTargetUser: mocks.access, actorHasOrgWideFacilityScope: () => true, listActorAccessibleFacilityIds: vi.fn() }));
vi.mock("@/lib/supabase/admin-client", () => ({ adminUpdateUserRole: mocks.role, adminDisableUser: mocks.disable, adminGetAuthSnapshotsByIds: vi.fn() }));
vi.mock("@/lib/audit/user-management-audit", () => ({ writeUserAuditEntry: mocks.audit }));
import { PATCH, DELETE } from "@/app/api/admin/users/[id]/route";
import { NextRequest } from "next/server";
let query: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks(); query = {};
  for (const name of ["select","eq","is","update"]) query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({data: {id: "target", organization_id: "org", app_role: "caregiver", is_active: true, email: "old@example.test"}});
  query.single = vi.fn().mockResolvedValue({data: {}, error: null});
  query.then = vi.fn((resolve) => resolve({data: [], error: null}));
  mocks.auth.mockResolvedValue({ actor: { id: "owner", app_role: "owner", organization_id: "org", admin: {from: () => query} } });
  mocks.access.mockResolvedValue(true);
});
it("does not claim success or change the profile after Auth rejects a role sync", async () => {
  mocks.role.mockRejectedValue(new Error("unavailable"));
  const response = await PATCH(new NextRequest("http://localhost", {method:"PATCH",body:JSON.stringify({app_role:"nurse"})}), {params:Promise.resolve({id:"target"})});
  expect(response.status).toBe(502);
  expect(query.update).not.toHaveBeenCalled();
});
it("rejects login email mutation through generic profile patch", async () => {
  const response = await PATCH(new NextRequest("http://localhost", {method:"PATCH",body:JSON.stringify({email:"new@example.test"})}), {params:Promise.resolve({id:"target"})});
  expect(response.status).toBe(422);
  expect(query.update).not.toHaveBeenCalled();
});
it("does not claim account deletion if Auth disable fails", async () => {
  mocks.disable.mockRejectedValue(new Error("unavailable"));
  const response = await DELETE(new NextRequest("http://localhost", {method:"DELETE"}), {params:Promise.resolve({id:"target"})});
  expect(response.status).toBe(502);
  expect(query.update).not.toHaveBeenCalled();
});

it("can repair Auth by resaving the intended profile role", async () => {
  mocks.role.mockResolvedValue(undefined);
  const response = await PATCH(new NextRequest("http://localhost", {method:"PATCH",body:JSON.stringify({app_role:"caregiver"})}), {params:Promise.resolve({id:"target"})});
  expect(response.status).toBe(200);
  expect(mocks.role).toHaveBeenCalledWith("target", "caregiver");
});
