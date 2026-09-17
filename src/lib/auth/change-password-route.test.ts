/**
 * POST /api/account/change-password — expiry boundary, rate limit, and the
 * guarantee that a wrong guess costs budget while a correct one refunds it. COL-362.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
  setMustChange: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getSession: mocks.getSession, updateUser: mocks.updateUser },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}));
vi.mock("@/lib/supabase/must-change-password-admin", () => ({
  adminSetMustChangePassword: mocks.setMustChange,
}));

import { POST } from "@/app/api/account/change-password/route";
import { clearFailureRateLimit } from "@/lib/security/in-memory-failure-rate-limit";
import { temporaryPasswordExpiresAt } from "./temporary-password";

function sessionFor(userId: string, appMetadata: Record<string, unknown> = {}) {
  return {
    data: {
      session: {
        user: { id: userId, email: "staff@example.test", app_metadata: appMetadata },
      },
    },
    error: null,
  };
}

function changeRequest(body: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/account/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: "TempPass123!",
        new_password: "BrandNewPass9!",
        confirm_password: "BrandNewPass9!",
        ...body,
      }),
    }),
  );
}

function freshUser() {
  const id = `user-${crypto.randomUUID()}`;
  clearFailureRateLimit(`account.change-password:${id}`);
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.setMustChange.mockResolvedValue({ expires_at: null });
});

describe("temporary password expiry at the API boundary", () => {
  it("accepts a change while the temporary password is still live", async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor(freshUser(), {
        must_change_password: true,
        must_change_password_expires_at: temporaryPasswordExpiresAt(new Date()),
      }),
    );

    const response = await changeRequest();

    expect(response.status).toBe(200);
    expect(mocks.setMustChange).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("refuses once the temporary password has expired", async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor(freshUser(), {
        must_change_password: true,
        must_change_password_expires_at: "2026-09-01T00:00:00.000Z",
      }),
    );

    const response = await changeRequest();

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("temporary_password_expired");
    // Checked before the password probe, so an expired account is not an oracle.
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses a forced change with no recorded deadline", async () => {
    mocks.getSession.mockResolvedValue(sessionFor(freshUser(), { must_change_password: true }));

    const response = await changeRequest();

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("temporary_password_expired");
  });

  it("leaves a voluntary change unaffected by expiry", async () => {
    // No forced-change flag: this is a user changing their own password by choice,
    // and a stale expiry value must not block them.
    mocks.getSession.mockResolvedValue(
      sessionFor(freshUser(), { must_change_password_expires_at: "2020-01-01T00:00:00.000Z" }),
    );

    const response = await changeRequest();

    expect(response.status).toBe(200);
  });
});

describe("change-password rate limit", () => {
  it("allows five wrong guesses then answers 429", async () => {
    const userId = freshUser();
    mocks.getSession.mockResolvedValue(sessionFor(userId));
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "bad" } });

    for (let i = 0; i < 5; i += 1) {
      const response = await changeRequest();
      expect(response.status, `attempt ${i + 1}`).toBe(403);
    }

    const blocked = await changeRequest();
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("rate_limited");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("stops probing the password once the limit is hit", async () => {
    const userId = freshUser();
    mocks.getSession.mockResolvedValue(sessionFor(userId));
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "bad" } });

    for (let i = 0; i < 5; i += 1) await changeRequest();
    mocks.signInWithPassword.mockClear();

    await changeRequest();

    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("spends no budget on a correct guess", async () => {
    const userId = freshUser();
    mocks.getSession.mockResolvedValue(sessionFor(userId));

    for (let i = 0; i < 20; i += 1) {
      const response = await changeRequest();
      expect(response.status, `attempt ${i + 1}`).toBe(200);
    }
  });

  it("refunds the budget after a successful change", async () => {
    const userId = freshUser();
    mocks.getSession.mockResolvedValue(sessionFor(userId));

    mocks.signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    for (let i = 0; i < 4; i += 1) await changeRequest();

    mocks.signInWithPassword.mockResolvedValue({ error: null });
    expect((await changeRequest()).status).toBe(200);

    // The four prior failures are cleared, so a fresh run of wrong guesses is allowed.
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    for (let i = 0; i < 5; i += 1) {
      expect((await changeRequest()).status, `post-refund ${i + 1}`).toBe(403);
    }
    expect((await changeRequest()).status).toBe(429);
  });

  it("budgets per user, not globally", async () => {
    const exhausted = freshUser();
    const fresh = freshUser();

    mocks.signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    mocks.getSession.mockResolvedValue(sessionFor(exhausted));
    for (let i = 0; i < 6; i += 1) await changeRequest();

    mocks.getSession.mockResolvedValue(sessionFor(fresh));
    const response = await changeRequest();

    expect(response.status).toBe(403);
  });

  it("rejects an unauthenticated caller before touching the limiter", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const response = await changeRequest();

    expect(response.status).toBe(401);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
