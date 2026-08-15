import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ServerAuthContext = {
  userId: string;
  email: string | null;
  organizationId: string;
  organizationName: string | null;
  appRole: Database["public"]["Enums"]["app_role"];
  fullName: string | null;
  avatarUrl: string | null;
};

export type ServerAuthContextResult =
  | { ok: true; ctx: ServerAuthContext }
  | { ok: false; error: string };

type ProfileWithOrganization = {
  organization_id: string | null;
  app_role: Database["public"]["Enums"]["app_role"];
  full_name: string | null;
  avatar_url: string | null;
  organizations: { name: string | null } | null;
};

/**
 * Request-scoped authenticated profile data access layer.
 *
 * React cache deduplicates the verified user and profile reads when several
 * Server Components or route helpers need authorization during one request.
 * The profile query also joins the organization so callers do not build their
 * own getUser → profile → organization waterfalls.
 */
export const getServerAuthContext = cache(async (): Promise<ServerAuthContextResult> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { ok: false, error: userError.message };
  if (!user) return { ok: false, error: "Sign in required." };

  const { data, error: profileError } = await supabase
    .from("user_profiles")
    .select("organization_id, app_role, full_name, avatar_url, organizations(name)")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) return { ok: false, error: profileError.message };

  const profile = data as unknown as ProfileWithOrganization | null;
  if (!profile?.organization_id) {
    return { ok: false, error: "Organization missing on profile." };
  }

  return {
    ok: true,
    ctx: {
      userId: user.id,
      email: user.email ?? null,
      organizationId: profile.organization_id,
      organizationName: profile.organizations?.name ?? null,
      appRole: profile.app_role,
      fullName: profile.full_name,
      avatarUrl: profile.avatar_url,
    },
  };
});
