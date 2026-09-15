import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
vi.mock("@/lib/rbac", () => ({
  canActorManageTarget: () => true,
}));

import { POST } from "@/app/api/admin/users/[id]/reset-password/route";

const targetId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.tempReady.mockResolvedValue({ temporary_password: "SignInReady1!" });
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

describe("POST /api/admin/users/[id]/reset-password", () => {
  it("confirms email and returns temp password in temp mode", async () => {
    const response = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ mode: "temp" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.temporary_password).toBe("SignInReady1!");
    expect(mocks.tempReady).toHaveBeenCalledWith(targetId);
  });
});
