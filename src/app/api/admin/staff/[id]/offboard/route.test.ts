import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  offboard: vi.fn(),
  reactivate: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: mocks.auth,
}));

vi.mock("@/lib/staff/staff-offboard-server", () => ({
  executeStaffOffboard: mocks.offboard,
  executeStaffReactivate: mocks.reactivate,
}));

import { POST as offboard } from "./route";
import { POST as reactivate } from "../reactivate/route";

const STAFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "key-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/admin/staff/[id]/offboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      actor: { id: "admin-1", organization_id: "org-1", app_role: "facility_admin" },
    });
  });

  it("returns 401 before work when the actor is missing", async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await offboard(request(`https://local.test/api/admin/staff/${STAFF_ID}/offboard`), {
      params: Promise.resolve({ id: STAFF_ID }),
    });
    expect(res.status).toBe(401);
    expect(mocks.offboard).not.toHaveBeenCalled();
  });

  it("passes the parsed body and idempotency key", async () => {
    mocks.offboard.mockResolvedValue({
      ok: true,
      status: 200,
      staff: { id: STAFF_ID, employment_status: "terminated" },
      haven_access: "revoked",
      access_control_sync: "queued",
      already_offboarded: false,
    });
    const res = await offboard(
      request(`https://local.test/api/admin/staff/${STAFF_ID}/offboard`, { reason: "left" }),
      { params: Promise.resolve({ id: STAFF_ID }) },
    );
    expect(res.status).toBe(200);
    expect(mocks.offboard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      STAFF_ID,
      { reason: "left" },
      "key-1",
    );
    await expect(res.json()).resolves.toMatchObject({
      haven_access: "revoked",
      access_control_sync: "queued",
    });
  });
});

describe("POST /api/admin/staff/[id]/reactivate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      actor: { id: "admin-1", organization_id: "org-1", app_role: "org_admin" },
    });
  });

  it("returns restore payload", async () => {
    mocks.reactivate.mockResolvedValue({
      ok: true,
      status: 200,
      staff: { id: STAFF_ID, employment_status: "active" },
      haven_access: "restored",
      access_control_sync: "cleared",
    });
    const res = await reactivate(
      request(`https://local.test/api/admin/staff/${STAFF_ID}/reactivate`, { reason: "rehired" }),
      { params: Promise.resolve({ id: STAFF_ID }) },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      haven_access: "restored",
      access_control_sync: "cleared",
    });
  });

  it("forwards command failures", async () => {
    mocks.reactivate.mockResolvedValue({
      ok: false,
      status: 422,
      error: "This staff member is already on the active roster.",
    });
    const res = await reactivate(request(`https://local.test/api/admin/staff/${STAFF_ID}/reactivate`), {
      params: Promise.resolve({ id: STAFF_ID }),
    });
    expect(res.status).toBe(422);
  });
});
