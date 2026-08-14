import type { SupabaseClient } from "@supabase/supabase-js";

import { loadClientRoleContext } from "@/lib/auth/client-role-context";
import type { Database } from "@/types/database";

export type ReportsRoleContext = {
  userId: string;
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

export async function loadReportsRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: ReportsRoleContext } | { ok: false; error: string }> {
  const roleContext = await loadClientRoleContext(supabase);
  if (!roleContext.ok) return roleContext;

  return {
    ok: true,
    ctx: {
      userId: roleContext.ctx.userId,
      organizationId: roleContext.ctx.organizationId,
      appRole: roleContext.ctx.appRole,
    },
  };
}

export function canManageReports(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin";
}

export function canRunReports(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin" || role === "facility_admin";
}
