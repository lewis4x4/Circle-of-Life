import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type RiskRoleContext = {
  userId: string;
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

export async function loadRiskRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: RiskRoleContext } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in required." };

  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) return { ok: false, error: profileErr.message };
  if (!profile?.organization_id) return { ok: false, error: "Organization missing on profile." };

  return {
    ok: true,
    ctx: {
      userId: user.id,
      organizationId: profile.organization_id,
      appRole: profile.app_role,
    },
  };
}

export function canManageRisk(role: Database["public"]["Enums"]["app_role"]): boolean {
  return role === "owner" || role === "org_admin";
}
