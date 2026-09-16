import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  getUserById: vi.fn(),
  setMustChange: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: mocks.inviteUserByEmail,
        createUser: mocks.createUser,
        updateUserById: mocks.updateUserById,
        getUserById: mocks.getUserById,
      },
    },
  }),
}));
vi.mock("@/lib/supabase/must-change-password-admin", () => ({
  adminSetMustChangePassword: mocks.setMustChange,
}));

import { adminCreateUser, adminInviteUser } from "./admin-client";

const options = { app_role: "caregiver", organization_id: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.setMustChange.mockResolvedValue({ expires_at: "2026-09-19T12:00:00.000Z" });
});

describe("adminInviteUser result inspection", () => {
  it("throws when GoTrue reports an error", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({ data: null, error: { message: "smtp down" } });

    await expect(adminInviteUser("a@example.test", options)).rejects.toThrow(/smtp down/);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("throws when GoTrue returns no error but also no user", async () => {
    // The silent-skip shape: a 200 with an empty payload must never read as sent.
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: null });

    await expect(adminInviteUser("a@example.test", options)).rejects.toThrow(
      /invite returned no user/,
    );
  });

  it("throws when the data envelope itself is missing", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({ data: null, error: null });

    await expect(adminInviteUser("a@example.test", options)).rejects.toThrow(
      /invite returned no user/,
    );
  });

  it("throws when the invite went out but app_metadata could not be written", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "u1", email: "a@example.test" } },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ error: { message: "metadata rejected" } });

    await expect(adminInviteUser("a@example.test", options)).rejects.toThrow(
      /app_metadata write failed/,
    );
  });

  it("mirrors role and org into app_metadata on success", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "u1", email: "a@example.test" } },
      error: null,
    });

    const result = await adminInviteUser("a@example.test", options);

    expect(result).toEqual({
      id: "u1",
      email: "a@example.test",
      app_role: "caregiver",
      organization_id: "org-1",
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { app_role: "caregiver", organization_id: "org-1" },
    });
  });
});

describe("adminCreateUser result inspection", () => {
  it("throws when create returns no user", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(adminCreateUser("a@example.test", options)).rejects.toThrow(
      /create returned no user/,
    );
    expect(mocks.setMustChange).not.toHaveBeenCalled();
  });

  it("flags must-change-password on success", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: { id: "u2", email: "a@example.test" } },
      error: null,
    });

    const result = await adminCreateUser("a@example.test", options);

    expect(result.user.id).toBe("u2");
    expect(result.temporary_password).toHaveLength(20);
    expect(result.expires_at).toBe("2026-09-19T12:00:00.000Z");
    expect(mocks.setMustChange).toHaveBeenCalledWith("u2", true);
  });
});
