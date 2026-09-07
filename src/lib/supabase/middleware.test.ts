import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.createServerClient }));

import { updateSession } from "./middleware";

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
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

});
