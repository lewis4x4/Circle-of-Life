import { describe, expect, it, vi } from "vitest";

import { loadClientRoleContext } from "./client-role-context";

describe("loadClientRoleContext", () => {
  it("uses current database actor state and deduplicates callers", async () => {
    const getClaims = vi.fn(async () => ({
      data: {
        claims: {
          sub: "user-1",
          app_metadata: {
            app_role: "org_admin",
            organization_id: "org-1",
          },
        },
      },
      error: null,
    }));
    const rpc = vi.fn().mockResolvedValue({
      data: { user_id: "user-1", organization_id: "org-1", app_role: "caregiver" },
      error: null,
    });
    const supabase = { auth: { getClaims }, rpc } as never;

    const [first, second] = await Promise.all([
      loadClientRoleContext(supabase),
      loadClientRoleContext(supabase),
    ]);

    expect(first).toEqual({
      ok: true,
      ctx: {
        userId: "user-1",
        organizationId: "org-1",
        appRole: "caregiver",
      },
    });
    expect(second).toEqual(first);
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not turn stale JWT app_metadata into client authority", async () => {
    const supabase = {
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", app_metadata: { app_role: "owner", organization_id: "org-1" } } },
          error: null,
        }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never;

    await expect(loadClientRoleContext(supabase)).resolves.toEqual({
      ok: false,
      error: "Current account authorization is unavailable.",
    });
  });
});
