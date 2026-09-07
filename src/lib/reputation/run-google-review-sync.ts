import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractGoogleReviewId,
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER,
  listAllReviewsForLocation,
  resolveGoogleLocationParent,
  reviewExcerptForRow,
} from "@/lib/reputation/google-business-reviews";
import { refreshAccessToken } from "@/lib/reputation/google-oauth";
import { logError } from "@/lib/observability/logger";
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
  | { status: "no_credentials"; reason?: "load_failed" }
  | { status: "token_refresh"; message: string }
  | { status: "account_load"; message: string; authorizationLost?: boolean };

const DETAIL_LOCATION_NOT_FOUND =
  "Could not match this Haven listing to a Google Business location. Review its External place ID.";
const DETAIL_PROVIDER_LOAD_FAILED = "Could not load Google reviews for this listing.";
const DETAIL_EXISTING_CHECK_FAILED = "Could not compare this listing with previously imported reviews.";
const DETAIL_INSERT_FAILED = "Could not save imported reviews for this listing.";
const TOKEN_REFRESH_FAILED = "Google authorization could not be refreshed. Reconnect Google and retry.";
const ACCOUNT_LOAD_FAILED = "Google Business listings could not be loaded. Retry the import.";
const AUTHORIZATION_LOST = "Your Haven access changed. Sign in again before importing reviews.";

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
  authorize?: (facilityId?: string) => Promise<boolean>;
}): Promise<GoogleReviewSyncResult> {
  const { organizationId, facilityId: facilityIdFilter, actorUserId, supabase, admin, authorize } = params;

  if (authorize && !(await authorize(facilityIdFilter))) {
    return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
  }

  const { data: cred, error: credErr } = await admin
    .from("reputation_google_oauth_credentials")
    .select("refresh_token")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (credErr) {
    logError("reputation.sync.google", credErr, { action: "load_credentials" });
    return { status: "no_credentials", reason: "load_failed" };
  }
  if (!cred?.refresh_token) {
    return { status: "no_credentials" };
  }

  if (authorize && !(await authorize(facilityIdFilter))) {
    return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
  }
  let accessToken: string;
  try {
    const tok = await refreshAccessToken(cred.refresh_token);
    accessToken = tok.access_token;
  } catch (e) {
    logError("reputation.sync.google", e, { action: "refresh_token" });
    return { status: "token_refresh", message: TOKEN_REFRESH_FAILED };
  }

  if (authorize && !(await authorize(facilityIdFilter))) {
    return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
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
    logError("reputation.sync.google", accLoadErr, { action: "load_accounts" });
    return { status: "account_load", message: ACCOUNT_LOAD_FAILED };
  }

  const rows = accounts ?? [];
  const details: GoogleReviewSyncDetail[] = [];
  let imported = 0;

  for (const acc of rows) {
    const label = acc.label ?? "(listing)";
    let reviews: Awaited<ReturnType<typeof listAllReviewsForLocation>> = [];

    try {
      if (authorize && !(await authorize(acc.facility_id))) {
        return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
      }
      const parent = await resolveGoogleLocationParent(accessToken, acc.external_place_id, acc.label ?? "");
      if (!parent) {
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: 0,
          inserted: 0,
          error: DETAIL_LOCATION_NOT_FOUND,
        });
        continue;
      }

      if (authorize && !(await authorize(acc.facility_id))) {
        return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
      }
      reviews = await listAllReviewsForLocation(accessToken, parent);
    } catch (e) {
      logError("reputation.sync.google", e, { action: "load_listing_reviews", reputationAccountId: acc.id });
      details.push({
        reputationAccountId: acc.id,
        label,
        fetched: 0,
        inserted: 0,
        error: DETAIL_PROVIDER_LOAD_FAILED,
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
        logError("reputation.sync.google", exErr, { action: "load_existing_reviews", reputationAccountId: acc.id });
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: reviews.length,
          inserted: 0,
          error: DETAIL_EXISTING_CHECK_FAILED,
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
      if (authorize && !(await authorize(acc.facility_id))) {
        return { status: "account_load", message: AUTHORIZATION_LOST, authorizationLost: true };
      }
      const { error: insErr } = await supabase.from("reputation_replies").insert(toInsert);
      if (insErr) {
        logError("reputation.sync.google", insErr, { action: "insert_reviews", reputationAccountId: acc.id });
        details.push({
          reputationAccountId: acc.id,
          label,
          fetched: reviews.length,
          inserted: 0,
          error: DETAIL_INSERT_FAILED,
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
