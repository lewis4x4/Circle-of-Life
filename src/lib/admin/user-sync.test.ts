import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), restrict: vi.fn(), expand: vi.fn(), audit: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: mocks.auth,
  actorCanAccessTargetUser: mocks.access,
  actorHasOrgWideFacilityScope: () => true,
  listActorAccessibleFacilityIds: vi.fn(),
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  adminGetAuthSnapshotsByIds: vi.fn(),
}));
vi.mock("@/lib/admin/user-access-lifecycle", () => ({
  commitRestrictiveUserAccess: mocks.restrict,
  commitExpansiveUserAccess: mocks.expand,
}));
vi.mock("@/lib/audit/user-management-audit", () => ({ writeUserAuditEntry: mocks.audit }));

import { DELETE, PATCH } from "@/app/api/admin/users/[id]/route";
import { NextRequest } from "next/server";

let query: Record<string, ReturnType<typeof vi.fn>>;
const restricted = {
  sync_status: "synchronized", job_id: "job-1", target_user_id: "target", organization_id: "org",
  app_role: "caregiver", auth_claim_version: 7, is_active: false,
  deleted_at: "2026-09-07T00:00:00.000Z", should_ban: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  query = {};
  for (const name of ["select", "eq", "is", "update"]) query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({
    data: { id: "target", organization_id: "org", app_role: "caregiver", is_active: true,
      email: "old@example.test", auth_claim_version: 6 },
  });
  query.single = vi.fn().mockResolvedValue({ data: {}, error: null });
  query.then = vi.fn((resolve) => resolve({ data: [], error: null }));
  mocks.auth.mockResolvedValue({
    actor: { id: "owner", app_role: "owner", organization_id: "org", admin: { from: () => query } },
  });
  mocks.access.mockResolvedValue(true);
  mocks.restrict.mockResolvedValue(restricted);
  mocks.expand.mockResolvedValue({ ...restricted, app_role: "nurse", is_active: true, deleted_at: null });
});

it("reports pending restriction synchronization without rolling back database authority", async () => {
  mocks.restrict.mockResolvedValue({ ...restricted, sync_status: "retry_required" });
  const response = await PATCH(
    new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ app_role: "dietary_aide" }) }),
    { params: Promise.resolve({ id: "target" }) },
  );
  expect(response.status).toBe(202);
  expect((await response.json()).sync_status).toBe("retry_required");
  expect(mocks.restrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: "demote" }));
  expect(query.update).not.toHaveBeenCalled();
});

it("rejects login email mutation through generic profile patch", async () => {
  const response = await PATCH(
    new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ email: "new@example.test" }) }),
    { params: Promise.resolve({ id: "target" }) },
  );
  expect(response.status).toBe(422);
  expect(query.update).not.toHaveBeenCalled();
});

it("returns pending sign-in sync after soft deletion", async () => {
  mocks.restrict.mockResolvedValue({ ...restricted, sync_status: "retry_required" });
  const response = await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), {
    params: Promise.resolve({ id: "target" }),
  });
  expect(response.status).toBe(202);
  expect(mocks.restrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: "soft_delete" }));
});

it("does not report a pending promotion as applied", async () => {
  mocks.expand.mockResolvedValue({ ...restricted, sync_status: "retry_required" });
  const response = await PATCH(
    new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ app_role: "nurse" }) }),
    { params: Promise.resolve({ id: "target" }) },
  );
  expect(response.status).toBe(202);
  expect(mocks.expand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: "promote" }));
  expect(query.update).not.toHaveBeenCalled();
});

it("repairs current role through the durable lifecycle command", async () => {
  const response = await PATCH(
    new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ app_role: "caregiver" }) }),
    { params: Promise.resolve({ id: "target" }) },
  );
  expect(response.status).toBe(200);
  expect(mocks.restrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: "demote", desiredRole: "caregiver" }));
});

it("passes request replay identity to a same-tier restriction", async () => {
  const response = await PATCH(
    new NextRequest("http://localhost", { method: "PATCH", headers: { "Idempotency-Key": "same-tier-command" },
      body: JSON.stringify({ app_role: "dietary_aide" }) }),
    { params: Promise.resolve({ id: "target" }) },
  );
  expect(response.status).toBe(200);
  expect(mocks.restrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    operation: "demote", desiredRole: "dietary_aide", requestKey: "same-tier-command",
  }));
});
