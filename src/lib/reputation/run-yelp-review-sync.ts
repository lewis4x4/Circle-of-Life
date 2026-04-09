import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchYelpBusinessReviews,
  YELP_IMPORTED_REPLY_PLACEHOLDER,
  yelpFusionEnvReady,
  yelpReviewExcerpt,
  type YelpFusionReview,
} from "@/lib/reputation/yelp-fusion";
import type { Database } from "@/types/database";

export type YelpReviewSyncDetail = {
  reputationAccountId: string;
  label: string;
  fetched: number;
  inserted: number;
  error: string | null;
};

export type YelpReviewSyncResult =
  | { status: "success"; imported: number; accountsProcessed: number; details: YelpReviewSyncDetail[] }
  | { status: "no_api_key" }
  | { status: "account_load"; message: string };

/**
 * Import Yelp Fusion review excerpts into `reputation_replies` (draft + placeholder).
 * `reputation_accounts.external_place_id` must be the Yelp **business id** (from Yelp URL or Fusion).
 */
export async function runYelpReviewSync(params: {
  organizationId: string;
  facilityId?: string;
  actorUserId: string;
  supabase: SupabaseClient<Database>;
}): Promise<YelpReviewSyncResult> {
  if (!yelpFusionEnvReady()) {
    return { status: "no_api_key" };
  }

  const { organizationId, facilityId: facilityIdFilter, actorUserId, supabase } = params;

  let accQuery = supabase
    .from("reputation_accounts")
    .select("id, facility_id, label, external_place_id, organization_id")
    .eq("organization_id", organizationId)
    .eq("platform", "yelp")
    .is("deleted_at", null);

  if (facilityIdFilter) {
    accQuery = accQuery.eq("facility_id", facilityIdFilter);
  }

  const { data: accounts, error: accLoadErr } = await accQuery;

  if (accLoadErr) {
    return { status: "account_load", message: accLoadErr.message };
  }

  const rows = accounts ?? [];
  const details: YelpReviewSyncDetail[] = [];
  let imported = 0;

  for (const acc of rows) {
    const label = acc.label ?? "(listing)";
    const businessId = acc.external_place_id?.trim() ?? "";

    if (!businessId) {
      details.push({
        reputationAccountId: acc.id,
        label,
        fetched: 0,
        inserted: 0,
        error: "Set External place ID to the Yelp business id (from the business URL or Yelp Fusion).",
      });
      continue;
    }

    let reviews: YelpFusionReview[] = [];
    try {
      reviews = await fetchYelpBusinessReviews(businessId);
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

    const ids = reviews.map((r) => r.id).filter((x): x is string => Boolean(x));
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
      const rid = rev.id;
      if (!rid || existing.has(rid)) continue;
      toInsert.push({
        organization_id: acc.organization_id,
        facility_id: acc.facility_id,
        reputation_account_id: acc.id,
        external_review_id: rid,
        review_excerpt: yelpReviewExcerpt(rev),
        reply_body: YELP_IMPORTED_REPLY_PLACEHOLDER,
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
