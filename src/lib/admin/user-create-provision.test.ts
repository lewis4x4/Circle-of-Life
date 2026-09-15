import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  invite: vi.fn(),
  create: vi.fn(),
  updateMeta: vi.fn(),
  tempReady: vi.fn(),
  resetEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  adminFindAuthUserByEmail: mocks.find,
  adminInviteUser: mocks.invite,
  adminCreateUser: mocks.create,
  adminUpdateUserAccessMetadata: mocks.updateMeta,
  adminSetUserSignInReadyWithTemporaryPassword: mocks.tempReady,
  adminSendPasswordResetEmail: mocks.resetEmail,
}));

import { provisionAuthUserForAdminCreate } from "./user-create-provision";

const base = {
  email: "celmore.homewoodalf@gmail.com",
  app_role: "caregiver",
  organization_id: "org-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invite.mockResolvedValue({ id: "new-auth", email: base.email });
  mocks.create.mockResolvedValue({
    user: { id: "created-auth", email: base.email },
    temporary_password: "TempPass123!",
  });
  mocks.tempReady.mockResolvedValue({ temporary_password: "RecoveryPass!" });
  mocks.updateMeta.mockResolvedValue(undefined);
  mocks.resetEmail.mockResolvedValue(undefined);
});

describe("provisionAuthUserForAdminCreate", () => {
  it("sends a fresh invite when no auth user exists", async () => {
    mocks.find.mockResolvedValue(null);
    const result = await provisionAuthUserForAdminCreate({ ...base, send_invite: true });
    expect(result).toMatchObject({
      userId: "new-auth",
      invitation_sent: true,
      provision_method: "invite_email",
    });
    expect(mocks.invite).toHaveBeenCalledOnce();
  });

  it("returns temp password for new user without invite", async () => {
    mocks.find.mockResolvedValue(null);
    const result = await provisionAuthUserForAdminCreate({ ...base, send_invite: false });
    expect(result).toMatchObject({
      userId: "created-auth",
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password: "TempPass123!",
    });
  });

  it("recovers existing unconfirmed auth with send_invite via temp password", async () => {
    mocks.find.mockResolvedValue({
      id: "orphan-auth",
      email: base.email,
      email_confirmed_at: null,
      last_sign_in_at: null,
    });
    const result = await provisionAuthUserForAdminCreate({ ...base, send_invite: true });
    expect(result).toMatchObject({
      userId: "orphan-auth",
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password: "RecoveryPass!",
    });
    expect(mocks.updateMeta).toHaveBeenCalledOnce();
    expect(mocks.tempReady).toHaveBeenCalledWith("orphan-auth");
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("sends recovery email for confirmed existing user with send_invite", async () => {
    mocks.find.mockResolvedValue({
      id: "active-auth",
      email: base.email,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-01-02T00:00:00Z",
    });
    const result = await provisionAuthUserForAdminCreate({ ...base, send_invite: true });
    expect(result).toMatchObject({
      userId: "active-auth",
      invitation_sent: true,
      provision_method: "password_reset_email",
    });
    expect(mocks.resetEmail).toHaveBeenCalledWith(base.email);
  });
});
