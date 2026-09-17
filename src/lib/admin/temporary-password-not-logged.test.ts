/**
 * A temporary password may appear in exactly one place: the JSON response body the
 * admin reads once. It must never reach Sentry, stdout, or the audit log — COL-362.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "Zq7!kMv3Rt9wXb2N";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  tempReady: vi.fn(),
  resetEmail: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mocks.auth }));
vi.mock("@/lib/supabase/admin-client", () => ({
  adminSetUserSignInReadyWithTemporaryPassword: mocks.tempReady,
  adminSendPasswordResetEmail: mocks.resetEmail,
}));
vi.mock("@/lib/audit/user-management-audit", () => ({ writeUserAuditEntry: mocks.audit }));
vi.mock("@/lib/rbac", () => ({ canActorManageTarget: () => true }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCalls.push(args),
  captureMessage: (...args: unknown[]) => sentryCalls.push(args),
}));

import { POST } from "@/app/api/admin/users/[id]/reset-password/route";

const sentryCalls: unknown[][] = [];
const consoleCalls: unknown[][] = [];
const targetId = "10000000-0000-4000-8000-000000000001";

/** Everything that left the process other than the HTTP response body. */
function sideChannels(): string {
  return JSON.stringify({
    sentry: sentryCalls,
    console: consoleCalls,
    audit: mocks.audit.mock.calls,
  });
}

function resetRequest(mode: "temp" | "email") {
  return POST(
    new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ mode }) }),
    { params: Promise.resolve({ id: targetId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sentryCalls.length = 0;
  consoleCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    consoleCalls.push(args);
  });
  vi.spyOn(console, "warn").mockImplementation((...args) => {
    consoleCalls.push(args);
  });
  vi.spyOn(console, "log").mockImplementation((...args) => {
    consoleCalls.push(args);
  });

  mocks.audit.mockResolvedValue(undefined);
  mocks.tempReady.mockResolvedValue({
    temporary_password: SECRET,
    expires_at: "2026-09-19T12:00:00.000Z",
  });
  mocks.resetEmail.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({
    actor: {
      id: "admin-1",
      organization_id: "org-1",
      app_role: "org_admin",
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
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("temporary password never leaves via a side channel", () => {
  it("returns it in the response body but logs nothing", async () => {
    const response = await resetRequest("temp");
    const json = await response.json();

    expect(json.temporary_password).toBe(SECRET);
    expect(json.temporary_password_expires_at).toBe("2026-09-19T12:00:00.000Z");
    expect(sideChannels()).not.toContain(SECRET);
  });

  it("keeps it out of the audit entry", async () => {
    await resetRequest("temp");

    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.audit.mock.calls[0])).not.toContain(SECRET);
  });

  it("keeps it out of the error path when the reset fails", async () => {
    // The generator runs before the failure, so a naive catch that logs the thrown
    // error alongside local state is exactly how this would leak.
    mocks.tempReady.mockRejectedValue(new Error(`Auth update failed for ${SECRET}`));

    const response = await resetRequest("temp");

    expect(response.status).toBe(500);
    // The response itself must not echo the upstream message either.
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(SECRET);
    expect(body).toBe(JSON.stringify({ error: "Failed to reset password" }));
  });

  it("logs the failure without the credential", async () => {
    mocks.tempReady.mockRejectedValue(new Error("Auth update failed"));

    await resetRequest("temp");

    // The failure is still observable — we are asserting redaction, not silence.
    expect(sentryCalls.length).toBeGreaterThan(0);
    expect(sideChannels()).not.toContain(SECRET);
  });
});
