import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import type { FinanceRoleContext } from "@/lib/finance/load-finance-context";

export async function loadFinanceRoleContextServer():
  Promise<{ ok: true; ctx: FinanceRoleContext } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in required." };

  const { data: profile, error: pErr } = await supabase
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return { ok: false, error: pErr.message };
  if (!profile?.organization_id) return { ok: false, error: "Organization missing on profile." };

  return {
    ok: true,
    ctx: {
      organizationId: profile.organization_id,
      appRole: profile.app_role as Database["public"]["Enums"]["app_role"],
    },
  };
}
