import { describe, expect, it, vi } from "vitest";

import { loadClientRoleContext } from "./client-role-context";

describe("loadClientRoleContext", () => {
  it("uses verified token claims and deduplicates callers without profile I/O", async () => {
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
    const from = vi.fn();
    const supabase = { auth: { getClaims }, from } as never;

    const [first, second] = await Promise.all([
      loadClientRoleContext(supabase),
      loadClientRoleContext(supabase),
    ]);

    expect(first).toEqual({
      ok: true,
      ctx: {
        userId: "user-1",
        organizationId: "org-1",
        appRole: "org_admin",
      },
    });
    expect(second).toEqual(first);
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
