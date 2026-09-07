import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { exchangeAuthorizationCode } from "@/lib/reputation/google-oauth";
import { verifyOAuthState } from "@/lib/reputation/oauth-state";

function appOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return new URL(request.url).origin;
}

function baseRedirect(request: Request, path: string, query: Record<string, string>) {
  const u = new URL(path, `${appOrigin(request)}/`);
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return NextResponse.redirect(u.toString());
}

/**
 * Google OAuth redirect URI handler — stores tokens via service role (RLS bypass).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return baseRedirect(request, "/admin/reputation/integrations", {
      error: oauthError,
    });
  }

  if (!code || !state) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "missing_code_or_state" });
  }

  const payload = verifyOAuthState(state);
  if (!payload) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "invalid_state" });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner"],
    scope: "reputation.oauth.google.callback",
  });
  if ("response" in actorResult) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "session_mismatch" });
  }
  const { actor } = actorResult;
  if (actor.id !== payload.userId || actor.organizationId !== payload.orgId) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "session_mismatch" });
  }

  const exchangeActorResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ["owner"],
    scope: "reputation.oauth.google.callback.exchange-revalidate",
  });
  if (
    "response" in exchangeActorResult ||
    exchangeActorResult.actor.organizationId !== payload.orgId
  ) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "session_mismatch" });
  }
  const exchangeActor = exchangeActorResult.actor;

  // Exchange is an irreversible provider-side action; current database authority
  // and the state-bound user/organization must be proven first.
  let tokens: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    tokens = await exchangeAuthorizationCode(code);
  } catch {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "token_exchange_failed" });
  }

  if (!tokens.refresh_token) {
    return baseRedirect(request, "/admin/reputation/integrations", {
      error: "no_refresh_token_retry_consent",
    });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const saveActorResult = await revalidateCurrentApiActor(exchangeActor, {
    allowedRoles: ["owner"],
    scope: "reputation.oauth.google.callback.save-revalidate",
  });
  if (
    "response" in saveActorResult ||
    saveActorResult.actor.organizationId !== payload.orgId
  ) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "session_mismatch" });
  }
  const saveActor = saveActorResult.actor;

  const { error: upsertErr } = await saveActor.admin.from("reputation_google_oauth_credentials").upsert(
    {
      organization_id: saveActor.organizationId,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      connected_by: saveActor.id,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );

  if (upsertErr) {
    return baseRedirect(request, "/admin/reputation/integrations", {
      error: "save_failed",
    });
  }

  return baseRedirect(request, "/admin/reputation/integrations", { connected: "1" });
}
