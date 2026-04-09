import { NextResponse } from "next/server";

import { runYelpReviewSync } from "@/lib/reputation/run-yelp-review-sync";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only: fetch Yelp Fusion review excerpts for `reputation_accounts` with `platform = yelp`.
 * Requires `YELP_FUSION_API_KEY` (server). Fusion returns up to 3 reviews per business.
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
      { error: "Only the organization owner can sync Yelp reviews." },
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

  const result = await runYelpReviewSync({
    organizationId: profile.organization_id,
    facilityId: facilityIdFilter,
    actorUserId: user.id,
    supabase,
  });

  if (result.status === "no_api_key") {
    return NextResponse.json(
      { error: "Yelp Fusion is not configured (set YELP_FUSION_API_KEY on the server)." },
      { status: 503 },
    );
  }
  if (result.status === "account_load") {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: result.imported,
    accountsProcessed: result.accountsProcessed,
    details: result.details,
    note: "Yelp Fusion returns up to 3 review excerpts per business.",
  });
}
