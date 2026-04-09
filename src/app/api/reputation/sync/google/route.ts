import { NextResponse } from "next/server";

import { runGoogleReviewSync } from "@/lib/reputation/run-google-review-sync";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Owner-only: fetch Google reviews for `reputation_accounts` with `platform = google_business`,
 * insert new rows into `reputation_replies` (draft + placeholder body). Idempotent on `external_review_id`.
 */
export async function POST(request: Request) {
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
      { error: "Only the organization owner can sync Google reviews." },
      { status: 403 },
    );
  }

  let facilityIdFilter: string | undefined;
  try {
    const j = (await request.json()) as { facilityId?: string };
    facilityIdFilter = typeof j.facilityId === "string" ? j.facilityId.trim() || undefined : undefined;
  } catch {
    facilityIdFilter = undefined;
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const result = await runGoogleReviewSync({
    organizationId: profile.organization_id,
    facilityId: facilityIdFilter,
    actorUserId: user.id,
    supabase,
    admin,
  });

  if (result.status === "no_credentials") {
    return NextResponse.json(
      { error: "Google is not connected for this organization. Connect under Integrations first." },
      { status: 400 },
    );
  }
  if (result.status === "token_refresh") {
    return NextResponse.json({ error: result.message }, { status: 502 });
  }
  if (result.status === "account_load") {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: result.imported,
    accountsProcessed: result.accountsProcessed,
    details: result.details,
  });
}
