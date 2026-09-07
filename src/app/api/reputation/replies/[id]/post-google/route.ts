import { NextResponse } from "next/server";

import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
} from "@/lib/auth/current-api-actor";
import {
  buildGoogleReviewResourceName,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  putGoogleReviewReply,
  resolveGoogleLocationParent,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
import { logError } from "@/lib/observability/logger";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type AccountJoin = {
  platform: string;
  external_place_id: string | null;
  label: string | null;
  organization_id: string;
};

const GOOGLE_REPLY_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const;

async function revalidateReplyAccess(
  actor: CurrentApiActor,
  row: { organization_id: string; facility_id: string },
) {
  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: GOOGLE_REPLY_ROLES,
    scope: "reputation.replies.post-google.revalidate",
  });
  if ("response" in currentResult) return currentResult;
  const currentActor = currentResult.actor;
  if (currentActor.organizationId !== row.organization_id) {
    return { response: NextResponse.json({ error: "Reply not found" }, { status: 404 }) };
  }
  const canAccessFacility = await serviceRoleUserHasFacilityAccess(currentActor.admin, {
    userId: currentActor.id,
    facilityId: row.facility_id,
    organizationId: currentActor.organizationId,
  });
  if (!canAccessFacility) {
    return { response: NextResponse.json({ error: "Reply not found" }, { status: 404 }) };
  }
  return { actor: currentActor };
}

/**
 * Post a draft reply to Google Business Profile (requires OAuth + verified location).
 * Updates `reputation_replies` to `posted` on success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const replyId = (await params).id;

  const actorResult = await requireCurrentApiActor({
    allowedRoles: GOOGLE_REPLY_ROLES,
    scope: "reputation.replies.post-google",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const supabase = actor.client;

  const { data: row, error: loadErr } = await supabase
    .from("reputation_replies")
    .select(
      "id, organization_id, facility_id, reputation_account_id, external_review_id, reply_body, status, reputation_accounts(platform, external_place_id, label, organization_id)",
    )
    .eq("id", replyId)
    .eq("organization_id", actor.organizationId)
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

  const initialAccess = await revalidateReplyAccess(actor, row);
  if ("response" in initialAccess) return initialAccess.response;

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
    .update({ reply_body: body, updated_by: initialAccess.actor.id }).eq("id", replyId).eq("status", "draft")
    .eq("reply_body", submitted.expected_reply_body).select("id").maybeSingle();
  if (saveError || !savedDraft) {
    if (saveError) logError("reputation.replies.post-google", saveError, { action: "save-draft", replyId });
    return NextResponse.json({ error: "Draft changed or could not be saved. Reload and review before posting." }, { status: 409 });
  }

  const { data: cred, error: credErr } = await actor.admin
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
  const refreshAccess = await revalidateReplyAccess(initialAccess.actor, row);
  if ("response" in refreshAccess) return refreshAccess.response;
  try {
    accessToken = (await refreshAccessToken(cred.refresh_token)).access_token;
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "refresh-token", replyId });
    return NextResponse.json({ error: "Google authorization could not be refreshed. Reconnect Google and retry." }, { status: 502 });
  }

  let locationParent: string | null;
  const resolveAccess = await revalidateReplyAccess(refreshAccess.actor, row);
  if ("response" in resolveAccess) return resolveAccess.response;
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

  const publishAccess = await revalidateReplyAccess(resolveAccess.actor, row);
  if ("response" in publishAccess) return publishAccess.response;
  try {
    await putGoogleReviewReply(accessToken, reviewName, body);
  } catch (e) {
    logError("reputation.replies.post-google", e, { action: "publish", replyId });
    return NextResponse.json({ error: "Google did not accept the reply. Review the connection and retry." }, { status: 502 });
  }

  const finalizeAccess = await revalidateReplyAccess(publishAccess.actor, row);
  if ("response" in finalizeAccess) {
    return NextResponse.json(
      { error: "Posted to Google, but Haven could not record the result. Reconcile the public reply before retrying." },
      { status: 500 },
    );
  }
  const now = new Date().toISOString();
  const { data: postedRow, error: upErr } = await supabase
    .from("reputation_replies")
    .update({
      status: "posted",
      posted_by_user_id: finalizeAccess.actor.id,
      posted_to_platform_at: now,
      updated_by: finalizeAccess.actor.id,
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
