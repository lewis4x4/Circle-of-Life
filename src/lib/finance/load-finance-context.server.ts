import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import type { FinanceRoleContext } from "@/lib/finance/load-finance-context";

type FinanceRoleContextServerOptions = {
  authSource?: "verified" | "session";
};

export async function loadFinanceRoleContextServer({
  authSource = "verified",
}: FinanceRoleContextServerOptions = {}):
  Promise<{ ok: true; ctx: FinanceRoleContext } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { user, error: userErr } =
    authSource === "session"
      ? await supabase.auth.getSession().then(({ data, error }) => ({
          user: data.session?.user ?? null,
          error,
        }))
      : await supabase.auth.getUser().then(({ data, error }) => ({
          user: data.user,
          error,
        }));
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
