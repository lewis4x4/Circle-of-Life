import { NextResponse } from "next/server";

import {
  buildGoogleReviewResourceName,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  putGoogleReviewReply,
  resolveGoogleLocationParent,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
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
  _request: Request,
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
    return NextResponse.json({ error: loadErr?.message ?? "Reply not found" }, { status: loadErr ? 500 : 404 });
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

  const body = row.reply_body?.trim() ?? "";
  if (!body || body === GOOGLE_IMPORTED_REPLY_PLACEHOLDER) {
    return NextResponse.json(
      { error: "Edit the reply text before posting (replace the imported placeholder)." },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: cred, error: credErr } = await admin
    .from("reputation_google_oauth_credentials")
    .select("refresh_token")
    .eq("organization_id", row.organization_id)
    .maybeSingle();

  if (credErr || !cred?.refresh_token) {
    return NextResponse.json(
      { error: "Google is not connected. Use Integrations to connect OAuth first." },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = (await refreshAccessToken(cred.refresh_token)).access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token refresh failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const locationParent = await resolveGoogleLocationParent(
    accessToken,
    acc.external_place_id,
    acc.label ?? "",
  );
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid review reference" },
      { status: 400 },
    );
  }

  try {
    await putGoogleReviewReply(accessToken, reviewName, body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Google API error";
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
      { error: `Posted to Google but failed to update record: ${upErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, posted_to_platform_at: now });
}
