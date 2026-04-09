/**
 * Yelp Fusion API v3 — business reviews (read-only).
 * Server env: YELP_FUSION_API_KEY (never expose to client).
 *
 * Limitation: the public Fusion `/reviews` endpoint returns up to **3** review excerpts per business
 * (Yelp platform cap for this API).
 */

export const YELP_IMPORTED_REPLY_PLACEHOLDER =
  "[Imported from Yelp — replace with your reply draft before posting.]";

const YELP_FUSION_BASE = "https://api.yelp.com/v3";

export function yelpFusionEnvReady(): boolean {
  return Boolean(process.env.YELP_FUSION_API_KEY?.trim());
}

export type YelpFusionReview = {
  id: string;
  text?: string;
  rating?: number;
  time_created?: string;
  user?: { name?: string };
};

type YelpReviewsResponse = {
  reviews?: YelpFusionReview[];
  total?: number;
  error?: { description?: string; code?: string };
};

export async function fetchYelpBusinessReviews(businessId: string): Promise<YelpFusionReview[]> {
  const key = process.env.YELP_FUSION_API_KEY?.trim();
  if (!key) {
    throw new Error("YELP_FUSION_API_KEY is not configured");
  }
  const url = `${YELP_FUSION_BASE}/businesses/${encodeURIComponent(businessId)}/reviews`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  const json = (await res.json()) as YelpReviewsResponse;
  if (!res.ok) {
    const msg = json.error?.description ?? `Yelp HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.reviews ?? [];
}

export function yelpReviewExcerpt(rev: YelpFusionReview): string {
  const t = rev.text?.trim();
  if (t) return t.length > 8000 ? t.slice(0, 8000) : t;
  const stars = typeof rev.rating === "number" ? ` (${rev.rating}/5)` : "";
  const who = rev.user?.name?.trim();
  const base = who ? `(No text) from ${who}${stars}` : `(No text)${stars}`;
  return base.slice(0, 8000);
}
