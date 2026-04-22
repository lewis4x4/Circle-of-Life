import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import type { RiskRoleContext } from "@/lib/risk/load-risk-context";

export async function loadRiskRoleContextServer():
  Promise<{ ok: true; ctx: RiskRoleContext } | { ok: false; error: string }> {
  const supabase = await createClient();
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
      appRole: profile.app_role as Database["public"]["Enums"]["app_role"],
    },
  };
}
