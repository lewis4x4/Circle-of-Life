import { NextResponse } from "next/server";

import {
  buildGoogleReviewResourceName,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  putGoogleReviewReply,
  resolveGoogleLocationParent,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
import { logError } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type AccountJoin = {
  platform: string;
  external_place_id: string | null;
  label: string | null;
  organization_id: string;
};

/**
 * Post a draft reply to Google Business Profile (requires OAuth + verified location).
 * Updates `reputation_replies` to `posted` on success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const replyId = (await params).id;

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
      logError("reputation.replies.post-google", loadErr, { action: "load", replyId });
      return NextResponse.json({ error: "Reply could not be loaded. Retry before posting." }, { status: 500 });
    }
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  const acc = row.reputation_accounts as AccountJoin | null;
  if (!acc || acc.platform !== "google_business") {
    return NextResponse.json({ error: "This reply is not linked to a Google Business listing." }, { status: 400 });
  }

  if (row.status !== "draft") {
    return NextResponse.json({ error: "Only draft replies can be posted to Google." }, { status: 400 });
  }

  const extReview = row.external_review_id?.trim() ?? "";
  if (!extReview) {
    return NextResponse.json(
      { error: "Missing external_review_id (import reviews or set the Google review id)." },
      { status: 400 },
    );
  }

  let submitted: { reply_body?: unknown; expected_reply_body?: unknown };
  try { submitted = await request.json(); } catch { return NextResponse.json({ error: "The visible reply text is required." }, { status: 400 }); }
  if (typeof submitted.reply_body !== "string" || typeof submitted.expected_reply_body !== "string") return NextResponse.json({ error: "Reply text and expected draft are required." }, { status: 400 });
  if (submitted.expected_reply_body !== row.reply_body) return NextResponse.json({ error: "This draft changed. Reload and review before posting." }, { status: 409 });
  const body = submitted.reply_body.trim();
  if (!body || body === GOOGLE_IMPORTED_REPLY_PLACEHOLDER) {
    return NextResponse.json(
      { error: "Edit the reply text before posting (replace the imported placeholder)." },
      { status: 400 },
    );
  }

  const { data: savedDraft, error: saveError } = await supabase.from("reputation_replies")
    .update({ reply_body: body, updated_by: user.id }).eq("id", replyId).eq("status", "draft")
    .eq("reply_body", submitted.expected_reply_body).select("id").maybeSingle();
  if (saveError || !savedDraft) {
    if (saveError) logError("reputation.replies.post-google", saveError, { action: "save-draft", replyId });
    return NextResponse.json({ error: "Draft changed or could not be saved. Reload and review before posting." }, { status: 409 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    logError("reputation.replies.post-google", error, { action: "create-service-client", replyId });
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: cred, error: credErr } = await admin
    .from("reputation_google_oauth_credentials")
    .select("refresh_token")
    .eq("organization_id", row.organization_id)
    .maybeSingle();

  if (credErr) {
    logError("reputation.replies.post-google", credErr, { action: "load-credentials", replyId });
    return NextResponse.json(
      { error: "Google connection status could not be verified. Retry before posting." },
      { status: 500 },
    );
  }
  if (!cred?.refresh_token) {
    return NextResponse.json(
      { error: "Google is not connected. Use Integrations to connect OAuth first." },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = (await refreshAccessToken(cred.refresh_token)).access_token;
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "refresh-token", replyId });
    return NextResponse.json({ error: "Google authorization could not be refreshed. Reconnect Google and retry." }, { status: 502 });
  }

  let locationParent: string | null;
  try {
    locationParent = await resolveGoogleLocationParent(
      accessToken,
      acc.external_place_id,
      acc.label ?? "",
    );
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "resolve-location", replyId });
    return NextResponse.json({ error: "Google Business location could not be verified. Retry before posting." }, { status: 502 });
  }
  if (!locationParent) {
    return NextResponse.json(
      {
        error:
          "Could not resolve Google Business location for this listing. Check External place ID on the reputation account.",
      },
      { status: 400 },
    );
  }

  let reviewName: string;
  try {
    reviewName = buildGoogleReviewResourceName(locationParent, extReview);
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "build-review-reference", replyId });
    return NextResponse.json(
      { error: "Google review reference is invalid. Re-import the review and retry." },
      { status: 400 },
    );
  }

  try {
    await putGoogleReviewReply(accessToken, reviewName, body);
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "publish", replyId });
    return NextResponse.json({ error: "Google did not accept the reply. Review the connection and retry." }, { status: 502 });
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
    if (upErr) logError("reputation.replies.post-google", upErr, { action: "record-posted", replyId });
    return NextResponse.json(
      { error: "Posted to Google, but Haven could not record the result. Reconcile the public reply before retrying." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, posted_to_platform_at: now });
}
