import { NextResponse } from "next/server";

import { exchangeAuthorizationCode } from "@/lib/reputation/google-oauth";
import { verifyOAuthState } from "@/lib/reputation/oauth-state";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user || user.id !== payload.userId) {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "session_mismatch" });
  }

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

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return baseRedirect(request, "/admin/reputation/integrations", { error: "server_misconfigured" });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: upsertErr } = await admin.from("reputation_google_oauth_credentials").upsert(
    {
      organization_id: payload.orgId,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      connected_by: user.id,
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
