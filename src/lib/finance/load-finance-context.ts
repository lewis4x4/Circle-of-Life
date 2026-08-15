import type { SupabaseClient } from "@supabase/supabase-js";

import { loadClientRoleContext } from "@/lib/auth/client-role-context";
import type { Database } from "@/types/database";

export type FinanceRoleContext = {
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

/**
 * @deprecated Prefer `useHavenAuth()` in client components — the (admin) layout
 * already loads session + profile once via HavenAuthProvider.
 */
export async function loadFinanceRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: FinanceRoleContext } | { ok: false; error: string }> {
  const roleContext = await loadClientRoleContext(supabase);
  if (!roleContext.ok) return roleContext;

  return {
    ok: true,
    ctx: {
      organizationId: roleContext.ctx.organizationId,
      appRole: roleContext.ctx.appRole,
    },
  };
}

export function canMutateFinance(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin";
}

/** facility_admin can create drafts (Enhanced tier) but not post. */
export function canCreateDraftFinance(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin" || role === "facility_admin";
}

export function canPostFinance(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin";
}
