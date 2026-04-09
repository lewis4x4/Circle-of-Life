import { NextResponse } from "next/server";

import { postYelpPublicReviewResponse, yelpPartnerReviewPostKey } from "@/lib/reputation/yelp-partner-reviews";
import { YELP_IMPORTED_REPLY_PLACEHOLDER } from "@/lib/reputation/yelp-fusion";
import { createClient } from "@/lib/supabase/server";

type AccountJoin = {
  platform: string;
  external_place_id: string | null;
  label: string | null;
  organization_id: string;
};

/**
 * Post a draft reply via Yelp Partner "Respond to Review" API.
 * Requires a review id on the row (from Fusion import). Updates `reputation_replies` to `posted` on success.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const replyId = (await params).id;

  if (!yelpPartnerReviewPostKey()) {
    return NextResponse.json(
      { error: "Yelp reply posting is not configured (set YELP_PARTNER_API_KEY or YELP_FUSION_API_KEY)." },
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

  const { data: row, error: loadErr } = await supabase
    .from("reputation_replies")
    .select(
      "id, organization_id, facility_id, reputation_account_id, external_review_id, reply_body, status, reputation_accounts(platform, external_place_id, label, organization_id)",
    )
    .eq("id", replyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadErr || !row) {
    return NextResponse.json({ error: loadErr?.message ?? "Reply not found" }, { status: loadErr ? 500 : 404 });
  }

  const acc = row.reputation_accounts as AccountJoin | null;
  if (!acc || acc.platform !== "yelp") {
    return NextResponse.json({ error: "This reply is not linked to a Yelp listing." }, { status: 400 });
  }

  if (row.status !== "draft") {
    return NextResponse.json({ error: "Only draft replies can be posted to Yelp." }, { status: 400 });
  }

  const reviewId = row.external_review_id?.trim() ?? "";
  if (!reviewId) {
    return NextResponse.json(
      { error: "Missing external_review_id (import Yelp reviews or set the Yelp review id)." },
      { status: 400 },
    );
  }

  const body = row.reply_body?.trim() ?? "";
  if (!body || body === YELP_IMPORTED_REPLY_PLACEHOLDER) {
    return NextResponse.json(
      { error: "Edit the reply text before posting (replace the imported placeholder)." },
      { status: 400 },
    );
  }

  try {
    await postYelpPublicReviewResponse(reviewId, body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Yelp API error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("reputation_replies")
    .update({
      status: "posted",
      posted_by_user_id: user.id,
      posted_to_platform_at: now,
      updated_by: user.id,
    })
    .eq("id", replyId);

  if (upErr) {
    return NextResponse.json(
      { error: `Posted to Yelp but failed to update record: ${upErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, posted_to_platform_at: now });
}
