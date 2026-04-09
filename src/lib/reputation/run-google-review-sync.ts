import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractGoogleReviewId,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  listAllReviewsForLocation,
  resolveGoogleLocationParent,
  reviewExcerptForRow,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
import type { Database } from "@/types/database";

export type GoogleReviewSyncDetail = {
  reputationAccountId: string;
  label: string;
  fetched: number;
  inserted: number;
  error: string | null;
};

export type GoogleReviewSyncResult =
  | { status: "success"; imported: number; accountsProcessed: number; details: GoogleReviewSyncDetail[] }
  | { status: "no_credentials" }
  | { status: "token_refresh"; message: string }
  | { status: "account_load"; message: string };

/**
 * Fetch Google reviews for org listings and insert new `reputation_replies` drafts.
 * `supabase` performs selects/inserts (user-scoped RLS or service role for cron).
 * `admin` must be service role — used only to read `reputation_google_oauth_credentials.refresh_token`.
 */
export async function runGoogleReviewSync(params: {
  organizationId: string;
  facilityId?: string;
  actorUserId: string;
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
}): Promise<GoogleReviewSyncResult> {
  const { organizationId, facilityId: facilityIdFilter, actorUserId, supabase, admin } = params;

  const { data: cred, error: credErr } = await admin
    .from("reputation_google_oauth_credentials")
    .select("refresh_token")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (credErr || !cred?.refresh_token) {
    return { status: "no_credentials" };
  }

  let accessToken: string;
  try {
    const tok = await refreshAccessToken(cred.refresh_token);
    accessToken = tok.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token refresh failed";
    return { status: "token_refresh", message: msg };
  }

  let accQuery = supabase
    .from("reputation_accounts")
    .select("id, facility_id, label, external_place_id, organization_id")
    .eq("organization_id", organizationId)
    .eq("platform", "google_business")
    .is("deleted_at", null);

  if (facilityIdFilter) {
    accQuery = accQuery.eq("facility_id", facilityIdFilter);
  }

  const { data: accounts, error: accLoadErr } = await accQuery;

  if (accLoadErr) {
    return { status: "account_load", message: accLoadErr.message };
  }

  const rows = accounts ?? [];
  const details: GoogleReviewSyncDetail[] = [];
  let imported = 0;

  for (const acc of rows) {
    const label = acc.label ?? "(listing)";
    let reviews: Awaited<ReturnType<typeof listAllReviewsForLocation>> = [];

    try {
      const parent = await resolveGoogleLocationParent(accessToken, acc.external_place_id, acc.label ?? "");
      if (!parent) {
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: 0,
          inserted: 0,
          error:
            "Could not resolve Google Business location. Set External place ID to the full resource name accounts/{account}/locations/{location}, a numeric location id, or match Listing label to the Google location title.",
        });
        continue;
      }

      reviews = await listAllReviewsForLocation(accessToken, parent);
    } catch (e) {
      details.push({
        reputationAccountId: acc.id,
        label,
        fetched: 0,
        inserted: 0,
        error: e instanceof Error ? e.message : String(e),
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
        created_by: actorUserId,
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

  return { status: "success", imported, accountsProcessed: rows.length, details };
}
