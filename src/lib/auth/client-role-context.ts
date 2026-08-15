import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type ClientRoleContext = {
  userId: string;
  organizationId: string;
  appRole: Database["public"]["Enums"]["app_role"];
};

export type ClientRoleContextResult =
  | { ok: true; ctx: ClientRoleContext }
  | { ok: false; error: string };

const roleContextPromises = new WeakMap<
  SupabaseClient<Database>,
  Promise<ClientRoleContextResult>
>();

export function clearClientRoleContext(
  supabase: SupabaseClient<Database>,
): void {
  roleContextPromises.delete(supabase);
}

export function primeClientRoleContext(
  supabase: SupabaseClient<Database>,
  ctx: ClientRoleContext,
): void {
  roleContextPromises.set(supabase, Promise.resolve({ ok: true, ctx }));
}

/**
 * Shared non-React role resolver for client mutation screens.
 *
 * The verified session claims normally carry both role and organization. This
 * avoids a getUser + user_profiles waterfall on every page. Older tokens
 * missing those claims use one profile fallback, cached per browser client.
 */
export function loadClientRoleContext(
  supabase: SupabaseClient<Database>,
): Promise<ClientRoleContextResult> {
  const cached = roleContextPromises.get(supabase);
  if (cached) return cached;

  const pending = (async (): Promise<ClientRoleContextResult> => {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError) return { ok: false, error: claimsError.message };

    const claims = claimsData?.claims;
    const userId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!userId) return { ok: false, error: "Sign in required." };

    const appMetadata = claims?.app_metadata as Record<string, unknown> | undefined;
    const metadataRole = appMetadata?.app_role;
    const metadataOrganizationId = appMetadata?.organization_id;
    if (
      typeof metadataRole === "string" &&
      typeof metadataOrganizationId === "string" &&
      metadataOrganizationId.length > 0
    ) {
      return {
        ok: true,
        ctx: {
          userId,
          organizationId: metadataOrganizationId,
          appRole: metadataRole as Database["public"]["Enums"]["app_role"],
        },
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("organization_id, app_role")
      .eq("id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (profileError) return { ok: false, error: profileError.message };
    if (!profile?.organization_id) {
      return { ok: false, error: "Organization missing on profile." };
    }

    return {
      ok: true,
      ctx: {
        userId,
        organizationId: profile.organization_id,
        appRole: profile.app_role,
      },
    };
  })();

  roleContextPromises.set(supabase, pending);
  void pending.then((result) => {
    if (!result.ok) roleContextPromises.delete(supabase);
  });
  return pending;
}
