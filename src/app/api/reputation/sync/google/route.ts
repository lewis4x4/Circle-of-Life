import { NextResponse } from "next/server";

import {
  extractGoogleReviewId,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  listAllReviewsForLocation,
  resolveGoogleLocationParent,
  reviewExcerptForRow,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

type Detail = {
  reputationAccountId: string;
  label: string;
  fetched: number;
  inserted: number;
  error: string | null;
};

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

  const { data: cred, error: credErr } = await admin
    .from("reputation_google_oauth_credentials")
    .select("refresh_token")
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  if (credErr || !cred?.refresh_token) {
    return NextResponse.json(
      { error: "Google is not connected for this organization. Connect under Integrations first." },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    const tok = await refreshAccessToken(cred.refresh_token);
    accessToken = tok.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token refresh failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let accQuery = supabase
    .from("reputation_accounts")
    .select("id, facility_id, label, external_place_id, organization_id")
    .eq("organization_id", profile.organization_id)
    .eq("platform", "google_business")
    .is("deleted_at", null);

  if (facilityIdFilter) {
    accQuery = accQuery.eq("facility_id", facilityIdFilter);
  }

  const { data: accounts, error: accLoadErr } = await accQuery;

  if (accLoadErr) {
    return NextResponse.json({ error: accLoadErr.message }, { status: 500 });
  }

  const rows = accounts ?? [];
  const details: Detail[] = [];
  let imported = 0;

  for (const acc of rows) {
    const label = acc.label ?? "(listing)";
    let parent: string | null = null;
    let fetchErr: string | null = null;
    let reviews: Awaited<ReturnType<typeof listAllReviewsForLocation>> = [];

    try {
      parent = await resolveGoogleLocationParent(accessToken, acc.external_place_id, acc.label ?? "");
      if (!parent) {
        fetchErr =
          "Could not resolve Google Business location. Set External place ID to the full resource name accounts/{account}/locations/{location}, a numeric location id, or match Listing label to the Google location title.";
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: 0,
          inserted: 0,
          error: fetchErr,
        });
        continue;
      }

      reviews = await listAllReviewsForLocation(accessToken, parent);
    } catch (e) {
      fetchErr = e instanceof Error ? e.message : String(e);
      details.push({
        reputationAccountId: acc.id,
        label,
        fetched: 0,
        inserted: 0,
        error: fetchErr,
      });
      continue;
    }

    const ids = reviews.map(extractGoogleReviewId).filter((x): x is string => Boolean(x));
    const uniqueIds = [...new Set(ids)];

    let existing = new Set<string>();
    if (uniqueIds.length > 0) {
      const { data: existingRows, error: exErr } = await supabase
        .from("reputation_replies")
        .select("external_review_id")
        .eq("reputation_account_id", acc.id)
        .is("deleted_at", null)
        .in("external_review_id", uniqueIds);

      if (exErr) {
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: reviews.length,
          inserted: 0,
          error: exErr.message,
        });
        continue;
      }
      existing = new Set(
        (existingRows ?? [])
          .map((r) => r.external_review_id)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      );
    }

    const toInsert: Database["public"]["Tables"]["reputation_replies"]["Insert"][] = [];
    for (const rev of reviews) {
      const rid = extractGoogleReviewId(rev);
      if (!rid || existing.has(rid)) continue;
      toInsert.push({
        organization_id: acc.organization_id,
        facility_id: acc.facility_id,
        reputation_account_id: acc.id,
        external_review_id: rid,
        review_excerpt: reviewExcerptForRow(rev),
        reply_body: GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
        status: "draft",
        created_by: user.id,
      });
      existing.add(rid);
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("reputation_replies").insert(toInsert);
      if (insErr) {
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: reviews.length,
          inserted: 0,
          error: insErr.message,
        });
        continue;
      }
      inserted = toInsert.length;
      imported += inserted;
    }

    details.push({
      reputationAccountId: acc.id,
      label,
      fetched: reviews.length,
      inserted,
      error: null,
    });
  }

  return NextResponse.json({
    ok: true,
    imported,
    accountsProcessed: rows.length,
    details,
  });
}
