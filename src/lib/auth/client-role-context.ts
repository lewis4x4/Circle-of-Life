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
 * JWT claims identify the caller only. Current role, organization, session,
 * status, and authorization version resolve through migration 326 before any
 * client mutation screen may act.
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

    const { data: actorData, error: actorError } = await supabase.rpc(
      "haven_current_edge_actor" as never,
    );
    if (actorError) return { ok: false, error: actorError.message };
    const actor = actorData as {
      user_id?: unknown;
      organization_id?: unknown;
      app_role?: unknown;
    } | null;
    if (
      actor?.user_id !== userId ||
      typeof actor.organization_id !== "string" ||
      typeof actor.app_role !== "string"
    ) {
      return { ok: false, error: "Current account authorization is unavailable." };
    }

    return {
      ok: true,
      ctx: {
        userId,
        organizationId: actor.organization_id,
        appRole: actor.app_role as Database["public"]["Enums"]["app_role"],
      },
    };
  })();

  roleContextPromises.set(supabase, pending);
  void pending.then((result) => {
    if (!result.ok) roleContextPromises.delete(supabase);
  });
  return pending;
}
