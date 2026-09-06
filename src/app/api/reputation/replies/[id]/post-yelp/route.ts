import { NextResponse } from "next/server";

import { postYelpPublicReviewResponse, yelpPartnerReviewPostKey } from "@/lib/reputation/yelp-partner-reviews";
import { YELP_IMPORTED_REPLY_PLACEHOLDER } from "@/lib/reputation/yelp-fusion";
import { logError } from "@/lib/observability/logger";
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
  request: Request,
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
    if (loadErr) {
      logError("reputation.replies.post-yelp", loadErr, { action: "load", replyId });
      return NextResponse.json({ error: "Reply could not be loaded. Retry before posting." }, { status: 500 });
    }
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
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

  let submitted: { reply_body?: unknown; expected_reply_body?: unknown };
  try { submitted = await request.json(); } catch { return NextResponse.json({ error: "The visible reply text is required." }, { status: 400 }); }
  if (typeof submitted.reply_body !== "string" || typeof submitted.expected_reply_body !== "string") return NextResponse.json({ error: "Reply text and expected draft are required." }, { status: 400 });
  if (submitted.expected_reply_body !== row.reply_body) return NextResponse.json({ error: "This draft changed. Reload and review before posting." }, { status: 409 });
  const body = submitted.reply_body.trim();
  if (!body || body === YELP_IMPORTED_REPLY_PLACEHOLDER) {
    return NextResponse.json(
      { error: "Edit the reply text before posting (replace the imported placeholder)." },
      { status: 400 },
    );
  }

  const { data: savedDraft, error: saveError } = await supabase.from("reputation_replies")
    .update({ reply_body: body, updated_by: user.id }).eq("id", replyId).eq("status", "draft")
    .eq("reply_body", submitted.expected_reply_body).select("id").maybeSingle();
  if (saveError || !savedDraft) {
    if (saveError) logError("reputation.replies.post-yelp", saveError, { action: "save-draft", replyId });
    return NextResponse.json({ error: "Draft changed or could not be saved. Reload and review before posting." }, { status: 409 });
  }

  try {
    await postYelpPublicReviewResponse(reviewId, body);
  } catch (e) {
    logError("reputation.replies.post-yelp", e, { action: "publish", replyId });
    return NextResponse.json({ error: "Yelp did not accept the reply. Review the connection and retry." }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { data: postedRow, error: upErr } = await supabase
    .from("reputation_replies")
    .update({
      status: "posted",
      posted_by_user_id: user.id,
      posted_to_platform_at: now,
      updated_by: user.id,
    })
    .eq("id", replyId).eq("reply_body", body).eq("status", "draft").select("id").maybeSingle();

  if (upErr || !postedRow) {
    if (upErr) logError("reputation.replies.post-yelp", upErr, { action: "record-posted", replyId });
    return NextResponse.json(
      { error: "Posted to Yelp, but Haven could not record the result. Reconcile the public reply before retrying." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, posted_to_platform_at: now });
}
