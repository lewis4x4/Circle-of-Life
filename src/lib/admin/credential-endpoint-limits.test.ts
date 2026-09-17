/**
 * Rate limiting and authorization on the two endpoints that mint or verify
 * credentials — COL-362.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  tempReady: vi.fn(),
  resetEmail: vi.fn(),
  audit: vi.fn(),
  canActorManageTarget: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mocks.auth }));
vi.mock("@/lib/supabase/admin-client", () => ({
  adminSetUserSignInReadyWithTemporaryPassword: mocks.tempReady,
  adminSendPasswordResetEmail: mocks.resetEmail,
}));
vi.mock("@/lib/audit/user-management-audit", () => ({ writeUserAuditEntry: mocks.audit }));
vi.mock("@/lib/rbac", () => ({ canActorManageTarget: mocks.canActorManageTarget }));

import { POST as resetPassword } from "@/app/api/admin/users/[id]/reset-password/route";
import { clearFailureRateLimit } from "@/lib/security/in-memory-failure-rate-limit";

const targetId = "10000000-0000-4000-8000-000000000001";

function actorNamed(id: string, appRole = "org_admin") {
  return {
    actor: {
      id,
      organization_id: "org-1",
      app_role: appRole,
      admin: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: targetId,
                    organization_id: "org-1",
                    email: "staff@example.test",
                    app_role: "caregiver",
                    is_active: true,
                    deleted_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    },
  };
}

function reset(mode: "temp" | "email" = "temp") {
  return resetPassword(
    new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ mode }) }),
    { params: Promise.resolve({ id: targetId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.tempReady.mockResolvedValue({
    temporary_password: "SignInReady1!",
    expires_at: "2026-09-19T12:00:00.000Z",
  });
  mocks.resetEmail.mockResolvedValue(undefined);
  mocks.canActorManageTarget.mockReturnValue(true);
});

describe("reset-password rate limit", () => {
  it("allows ten resets then answers 429 with Retry-After", async () => {
    const actorId = `admin-${crypto.randomUUID()}`;
    clearFailureRateLimit(`admin.reset-password:${actorId}`);
    mocks.auth.mockResolvedValue(actorNamed(actorId));

    for (let i = 0; i < 10; i += 1) {
      const response = await reset();
      expect(response.status, `attempt ${i + 1}`).toBe(200);
    }

    const blocked = await reset();
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("rate_limited");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("does not mint a credential once the limit is hit", async () => {
    const actorId = `admin-${crypto.randomUUID()}`;
    clearFailureRateLimit(`admin.reset-password:${actorId}`);
    mocks.auth.mockResolvedValue(actorNamed(actorId));

    for (let i = 0; i < 10; i += 1) await reset();
    mocks.tempReady.mockClear();

    const blocked = await reset();

    expect(blocked.status).toBe(429);
    expect(mocks.tempReady).not.toHaveBeenCalled();
  });

  it("budgets per admin, not globally", async () => {
    const exhausted = `admin-${crypto.randomUUID()}`;
    const fresh = `admin-${crypto.randomUUID()}`;
    clearFailureRateLimit(`admin.reset-password:${exhausted}`);
    clearFailureRateLimit(`admin.reset-password:${fresh}`);

    mocks.auth.mockResolvedValue(actorNamed(exhausted));
    for (let i = 0; i < 11; i += 1) await reset();

    mocks.auth.mockResolvedValue(actorNamed(fresh));
    const response = await reset();

    expect(response.status).toBe(200);
  });
});

describe("reset-password authorization", () => {
  it("denies a non super admin before any rate-limit budget is spent", async () => {
    // requireAdminApiActor is configured with owner/org_admin only; a denied actor
    // never reaches the handler body.
    mocks.auth.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await reset();

    expect(response.status).toBe(403);
    expect(mocks.tempReady).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("restricts the route to owner and org_admin", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/admin/users/[id]/reset-password/route.ts", "utf8"),
    );
    expect(source).toContain('allowedRoles: ["owner", "org_admin"]');
  });

  it("stops a manager-level actor from resetting an owner", async () => {
    const actorId = `admin-${crypto.randomUUID()}`;
    clearFailureRateLimit(`admin.reset-password:${actorId}`);
    mocks.auth.mockResolvedValue(actorNamed(actorId));
    mocks.canActorManageTarget.mockReturnValue(false);

    const response = await reset();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only owners can reset owner passwords" });
    expect(mocks.tempReady).not.toHaveBeenCalled();
  });

  it("refuses a self-reset through the admin route", async () => {
    clearFailureRateLimit(`admin.reset-password:${targetId}`);
    mocks.auth.mockResolvedValue(actorNamed(targetId));

    const response = await reset();

    expect(response.status).toBe(422);
    expect(mocks.tempReady).not.toHaveBeenCalled();
  });
});

describe("create-user authorization", () => {
  it("restricts creation to owner, org_admin and facility_admin", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/admin/users/route.ts", "utf8"),
    );
    expect(source).toContain('allowedRoles: ["owner", "org_admin", "facility_admin"]');
    // And a creator still cannot mint a peer or a superior.
    expect(source).toContain("canManageUser(actor.app_role, data.app_role)");
  });
});
