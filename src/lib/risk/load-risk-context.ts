import type { SupabaseClient } from "@supabase/supabase-js";

import { loadClientRoleContext } from "@/lib/auth/client-role-context";
import type { Database } from "@/types/database";

export type RiskRoleContext = {
  userId: string;
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

export async function loadRiskRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: RiskRoleContext } | { ok: false; error: string }> {
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

export function canManageRisk(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin";
}
