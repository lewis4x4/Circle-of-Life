import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), restrict: vi.fn(), expand: vi.fn() }));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mocks.auth }));
vi.mock("@/lib/admin/user-access-lifecycle", () => ({
  commitRestrictiveUserAccess: mocks.restrict, commitExpansiveUserAccess: mocks.expand,
}));
import { DELETE } from "@/app/api/admin/users/[id]/facility-access/[facilityId]/route";
import { POST } from "@/app/api/admin/users/[id]/facility-access/route";

const id = "10000000-0000-4000-8000-000000000001";
const facilityId = "20000000-0000-4000-8000-000000000002";
const context = () => ({ params: Promise.resolve({ id, facilityId }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ actor: { id: "actor", organization_id: "org", admin: {} } });
  mocks.restrict.mockResolvedValue({ sync_status: "synchronized", job_id: "receipt" });
  mocks.expand.mockResolvedValue({ sync_status: "synchronized", job_id: "receipt" });
});
it("routes a last-facility revoke and lost-response replay to the same durable command", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await DELETE(new NextRequest(`http://localhost/api/admin/users/${id}/facility-access/${facilityId}`, {
      method: "DELETE", headers: { "Idempotency-Key": "revoke-receipt" },
    }), context());
    expect(response.status).toBe(204);
  }
  expect(mocks.restrict).toHaveBeenCalledTimes(2);
  expect(mocks.restrict).toHaveBeenLastCalledWith({}, expect.objectContaining({
    targetUserId: id, facilityId, requestKey: "revoke-receipt", operation: "revoke_facility",
  }));
});
it("does not block a granted-facility replay before the database reads its receipt", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await POST(new NextRequest("http://localhost", { method: "POST",
      headers: { "Idempotency-Key": "grant-receipt" }, body: JSON.stringify({ facility_id: facilityId, is_primary: true }),
    }), context());
    expect(response.status).toBe(201);
    expect((await response.json()).data.job_id).toBe("receipt");
  }
  expect(mocks.expand).toHaveBeenCalledTimes(2);
});
it("reports a changed-payload receipt conflict instead of success", async () => {
  mocks.expand.mockRejectedValue({ code: "23505", message: "Lifecycle request key payload mismatch" });
  const response = await POST(new NextRequest("http://localhost", { method: "POST",
    headers: { "Idempotency-Key": "grant-receipt" }, body: JSON.stringify({ facility_id: facilityId, is_primary: false }),
  }), context());
  expect(response.status).toBe(409);
});
it("validates actual child route IDs before mutation", async () => {
  const response = await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), {
    params: Promise.resolve({ id, facilityId: "invalid" }),
  });
  expect(response.status).toBe(400);
  expect(mocks.restrict).not.toHaveBeenCalled();
});
it("returns pending status for Auth failure after revocation", async () => {
  mocks.restrict.mockResolvedValue({ sync_status: "retry_required", job_id: "receipt" });
  const response = await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), context());
  expect(response.status).toBe(202);
  expect((await response.json()).sync_status).toBe("retry_required");
});
