import { NextResponse } from "next/server";

import { googleOAuthEnvReady } from "@/lib/reputation/google-oauth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: profile, error: profErr } = await admin
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile?.organization_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  const { data: cred } = await admin
    .from("reputation_google_oauth_credentials")
    .select("connected_at")
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  return NextResponse.json({
    googleOAuthEnvConfigured: googleOAuthEnvReady(),
    stateSecretConfigured: Boolean(process.env.REPUTATION_OAUTH_STATE_SECRET?.trim()?.length),
    connected: Boolean(cred),
    connectedAt: cred?.connected_at ?? null,
    canManage: profile.app_role === "owner",
  });
}
