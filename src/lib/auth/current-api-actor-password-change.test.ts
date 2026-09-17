/**
 * A user owing a password change cannot act through the API. Enforced on the shared
 * actor resolver so it covers every session-derived route — COL-362.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  createServiceRoleClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: mocks.maybeSingle }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { requireCurrentApiActor } from "./current-api-actor";

function profile(settings: unknown) {
  return {
    data: {
      id: "user-1",
      organization_id: "org-1",
      app_role: "facility_admin",
      email: "staff@example.test",
      full_name: "Staff Member",
      settings,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.createServiceRoleClient.mockReturnValue({});
});

describe("requireCurrentApiActor and a pending password change", () => {
  it("denies with 403 password_change_required", async () => {
    mocks.maybeSingle.mockResolvedValue(profile({ must_change_password: true }));

    const result = await requireCurrentApiActor();

    expect("response" in result).toBe(true);
    if ("response" in result) {
      expect(result.response.status).toBe(403);
      expect(await result.response.json()).toEqual({
        error: "You must change your temporary password before continuing.",
        code: "password_change_required",
      });
    }
  });

  it("denies before the role check, so the reason is never masked as a role problem", async () => {
    mocks.maybeSingle.mockResolvedValue(profile({ must_change_password: true }));

    // This actor would also fail the role gate. The password reason must win, or the
    // user is told to ask for permissions they already have.
    const result = await requireCurrentApiActor({ allowedRoles: ["owner"] });

    expect("response" in result).toBe(true);
    if ("response" in result) {
      expect((await result.response.json()).code).toBe("password_change_required");
    }
  });

  it("allows the endpoints that exist to resolve the change", async () => {
    mocks.maybeSingle.mockResolvedValue(profile({ must_change_password: true }));

    const result = await requireCurrentApiActor({ allowPendingPasswordChange: true });

    expect("actor" in result).toBe(true);
  });

  it("allows a user with no pending change", async () => {
    mocks.maybeSingle.mockResolvedValue(profile({}));

    const result = await requireCurrentApiActor();

    expect("actor" in result).toBe(true);
  });

  it("allows a user whose settings are null", async () => {
    mocks.maybeSingle.mockResolvedValue(profile(null));

    const result = await requireCurrentApiActor();

    expect("actor" in result).toBe(true);
  });

  it("ignores a non-boolean flag rather than locking the account out", async () => {
    mocks.maybeSingle.mockResolvedValue(profile({ must_change_password: "true" }));

    const result = await requireCurrentApiActor();

    expect("actor" in result).toBe(true);
  });
});
