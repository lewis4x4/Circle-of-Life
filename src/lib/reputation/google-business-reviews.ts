/**
 * Google Business Profile API — list reviews (v4) + resolve location parent.
 * Requires OAuth scope https://www.googleapis.com/auth/business.manage
 */

export const GOOGLE_IMPORTED_REPLY_PLACEHOLDER =
  "[Imported from Google — replace with your reply draft before posting.]";

const MYBUSINESS_V4 = "https://mybusiness.googleapis.com/v4";
const ACCOUNT_MGMT_V1 = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_V1 = "https://mybusinessbusinessinformation.googleapis.com/v1";

export type GoogleReview = {
  name?: string;
  reviewId?: string;
  comment?: string;
  starRating?: string;
  createTime?: string;
  reviewer?: { displayName?: string };
};

type ListReviewsResponse = {
  reviews?: GoogleReview[];
  nextPageToken?: string;
};

type ListAccountsResponse = {
  accounts?: { name?: string }[];
  nextPageToken?: string;
};

type LocationRow = { name?: string; title?: string };

type ListLocationsResponse = {
  locations?: LocationRow[];
  nextPageToken?: string;
};

const FULL_LOCATION_RE = /^accounts\/[^/]+\/locations\/[^/]+$/;

async function googleJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } }).error?.message ??
      `Google API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

/** List review resources for a location parent `accounts/{id}/locations/{id}`. */
export async function listAllReviewsForLocation(
  accessToken: string,
  locationParent: string,
  maxPages = 25,
): Promise<GoogleReview[]> {
  const out: GoogleReview[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const u = new URL(`${MYBUSINESS_V4}/${locationParent}/reviews`);
    u.searchParams.set("pageSize", "50");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await googleJson<ListReviewsResponse>(u.toString(), accessToken);
    for (const r of page.reviews ?? []) {
      out.push(r);
    }
    pageToken = page.nextPageToken;
    pages += 1;
    if (!pageToken) break;
  }
  return out;
}

async function listAllAccountNames(accessToken: string): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const u = new URL(`${ACCOUNT_MGMT_V1}/accounts`);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await googleJson<ListAccountsResponse>(u.toString(), accessToken);
    for (const a of page.accounts ?? []) {
      if (a.name) names.push(a.name);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return names;
}

async function listLocationsForAccount(accessToken: string, accountName: string): Promise<LocationRow[]> {
  const rows: LocationRow[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const u = new URL(`${BUSINESS_INFO_V1}/${accountName}/locations`);
    u.searchParams.set("readMask", "name,title");
    u.searchParams.set("pageSize", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await googleJson<ListLocationsResponse>(u.toString(), accessToken);
    for (const loc of page.locations ?? []) {
      rows.push(loc);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return rows;
}

/**
 * Resolve `reputation_accounts.external_place_id` to a v4 reviews parent
 * (`accounts/.../locations/...`).
 *
 * - If the value is already a full location resource name, use it.
 * - Else if it is numeric, find a location whose resource name ends with `/locations/{id}`.
 * - Else match `accountLabel` to `title` (case-insensitive, trimmed).
 */
export async function resolveGoogleLocationParent(
  accessToken: string,
  externalPlaceId: string | null | undefined,
  accountLabel: string,
): Promise<string | null> {
  const raw = externalPlaceId?.trim() ?? "";
  if (!raw) return null;
  if (FULL_LOCATION_RE.test(raw)) return raw;

  const accounts = await listAllAccountNames(accessToken);
  const allLocs: LocationRow[] = [];
  for (const acc of accounts) {
    const locs = await listLocationsForAccount(accessToken, acc);
    allLocs.push(...locs);
  }

  if (/^\d+$/.test(raw)) {
    const suffix = `/locations/${raw}`;
    const hit = allLocs.find((l) => l.name?.endsWith(suffix));
    return hit?.name ?? null;
  }

  const want = accountLabel.trim().toLowerCase();
  if (want.length > 0) {
    const hit = allLocs.find((l) => (l.title ?? "").trim().toLowerCase() === want);
    return hit?.name ?? null;
  }

  return null;
}

export function extractGoogleReviewId(review: GoogleReview): string | null {
  if (review.reviewId && review.reviewId.length > 0) return review.reviewId;
  if (review.name) {
    const parts = review.name.split("/");
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return null;
}

export function reviewExcerptForRow(review: GoogleReview): string {
  const c = review.comment?.trim();
  if (c) return c.length > 8000 ? c.slice(0, 8000) : c;
  const stars = review.starRating ? ` (${review.starRating})` : "";
  const who = review.reviewer?.displayName?.trim();
  const base = who ? `(No comment from ${who})${stars}` : `(No comment)${stars}`;
  return base.slice(0, 8000);
}
