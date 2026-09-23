import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.createServerClient }));

import { updateSession } from "./middleware";
import { SHELL_ACTOR_CACHE_COOKIE, signShellActor } from "./shell-actor-cache";

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.HAVEN_SHELL_ACTOR_CACHE_SECRET;
    delete process.env.HAVEN_SHELL_ACTOR_CACHE_TTL_SECONDS;
  });

  it("routes with the current database actor instead of stale JWT metadata", async () => {
    const signOut = vi.fn();
    state.createServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", app_metadata: { app_role: "owner" } } },
          error: null,
        }),
        signOut,
      },
      rpc: vi.fn().mockResolvedValue({
        data: { user_id: "user-1", organization_id: "org-1", app_role: "caregiver", auth_claim_version: 8 },
        error: null,
      }),
    });

    const result = await updateSession(new NextRequest("http://localhost/admin"));
    expect(result.user?.app_metadata).toMatchObject({
      app_role: "caregiver",
      organization_id: "org-1",
      auth_claim_version: 8,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("globally signs out a stale managed session after current authority rejects it", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    state.createServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", app_metadata: { app_role: "owner" } } },
          error: null,
        }),
        signOut,
      },
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "HAVEN_AUTHORIZATION_STALE", message: "Sign in again" },
      }),
    });

    const result = await updateSession(new NextRequest("http://localhost/admin"));
    expect(result.user).toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("denies an unavailable authority read without revoking healthy sessions", async () => {
    const signOut = vi.fn();
    state.createServerClient.mockReturnValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null }), signOut },
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "57014", message: "temporary timeout" } }),
    });
    const result = await updateSession(new NextRequest("http://localhost/admin"));
    expect(result.user).toBeNull();
    expect(result.unavailable).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });

  describe("signed shell actor cache (COL-674)", () => {
    const secret = "k".repeat(48);
    const claims = { sub: "user-1", session_id: "session-1", auth_claim_version: 4 };
    const actor = { user_id: "user-1", organization_id: "org-1", app_role: "owner", auth_claim_version: 4 };

    function client(rpcResult: unknown) {
      const rpc = vi.fn().mockResolvedValue(rpcResult);
      state.createServerClient.mockReturnValue({
        auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims }, error: null }), signOut: vi.fn() },
        rpc,
      });
      return rpc;
    }

    function requestWith(cookie?: string) {
      const request = new NextRequest("http://localhost/admin");
      if (cookie) request.cookies.set(SHELL_ACTOR_CACHE_COOKIE, cookie);
      return request;
    }

    it("stores the actor after the database answers and routes the next request without the RPC", async () => {
      process.env.HAVEN_SHELL_ACTOR_CACHE_SECRET = secret;
      const rpc = client({ data: actor, error: null });
      const first = await updateSession(requestWith());
      expect(rpc).toHaveBeenCalledTimes(1);
      const stored = first.response.cookies.get(SHELL_ACTOR_CACHE_COOKIE)?.value;
      expect(stored).toBeTruthy();

      const rpcAgain = client({ data: actor, error: null });
      const second = await updateSession(requestWith(stored));
      expect(rpcAgain).not.toHaveBeenCalled();
      expect(second.user?.app_metadata).toMatchObject({ app_role: "owner", organization_id: "org-1" });
    });

    it("asks the database when the cache is off, even with a cookie present", async () => {
      const value = await signShellActor(actor, { sub: "user-1", sessionId: "session-1", claimVersion: 4 }, { secret, ttlSeconds: 60 });
      const rpc = client({ data: { ...actor, app_role: "caregiver" }, error: null });
      const result = await updateSession(requestWith(value ?? undefined));
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(result.user?.app_metadata).toMatchObject({ app_role: "caregiver" });
    });

    it("ignores a cookie from another session and never stores a pending password change", async () => {
      process.env.HAVEN_SHELL_ACTOR_CACHE_SECRET = secret;
      const foreign = await signShellActor(actor, { sub: "user-1", sessionId: "other", claimVersion: 4 }, { secret, ttlSeconds: 60 });
      const rpc = client({ data: { ...actor, must_change_password: true }, error: null });
      const result = await updateSession(requestWith(foreign ?? undefined));
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(result.user?.app_metadata).toMatchObject({ must_change_password: true });
      const cookie = result.response.cookies.get(SHELL_ACTOR_CACHE_COOKIE);
      expect(cookie?.value ?? "").toBe("");
    });
  });
});
