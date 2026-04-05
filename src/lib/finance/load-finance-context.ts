import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FinanceRoleContext = {
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

export async function loadFinanceRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: FinanceRoleContext } | { ok: false; error: string }> {
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
      appRole: profile.app_role,
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
