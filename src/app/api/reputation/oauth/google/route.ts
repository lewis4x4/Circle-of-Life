import { NextResponse } from "next/server";

import { buildGoogleAuthorizeUrl, googleOAuthEnvReady } from "@/lib/reputation/google-oauth";
import { signOAuthState } from "@/lib/reputation/oauth-state";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts Google OAuth (Business Profile scope). Owner-only.
 */
export async function GET() {
  if (!googleOAuthEnvReady()) {
    return NextResponse.json(
      { error: "Google OAuth is not configured (set REPUTATION_GOOGLE_* env vars)." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile, error: profErr } = await supabase
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile?.organization_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  if (profile.app_role !== "owner") {
    return NextResponse.json(
      { error: "Only the organization owner can connect Google for reputation integrations." },
      { status: 403 },
    );
  }

  const state = signOAuthState({
    orgId: profile.organization_id,
    userId: user.id,
  });

  if (!state) {
    return NextResponse.json(
      { error: "Server missing REPUTATION_OAUTH_STATE_SECRET (min 16 chars)." },
      { status: 503 },
    );
  }

  const url = buildGoogleAuthorizeUrl(state);
  return NextResponse.redirect(url);
}
