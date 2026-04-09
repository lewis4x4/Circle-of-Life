/**
 * Yelp Partner API — public response to a review (Respond to Reviews).
 * https://docs.developer.yelp.com/docs/respond-to-reviews-api-v2
 *
 * Auth: Bearer token. Access is Partner-only; many keys only work with Fusion read APIs —
 * use YELP_PARTNER_API_KEY when Yelp provisions a Partner key, else we fall back to YELP_FUSION_API_KEY.
 */

/** Prefer Partner key; fall back to Fusion key for single-key pilots. */
export function yelpPartnerReviewPostKey(): string | null {
  const a = process.env.YELP_PARTNER_API_KEY?.trim();
  const b = process.env.YELP_FUSION_API_KEY?.trim();
  return a || b || null;
}

export function yelpPartnerPostEnvReady(): boolean {
  return Boolean(yelpPartnerReviewPostKey());
}

/**
 * POST `response_text` as `public_comment` for a Yelp review id (from Fusion import `review.id`).
 */
export async function postYelpPublicReviewResponse(reviewId: string, responseText: string): Promise<void> {
  const key = yelpPartnerReviewPostKey();
  if (!key) {
    throw new Error("Yelp API key not configured (set YELP_PARTNER_API_KEY or YELP_FUSION_API_KEY)");
  }
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new Error("Reply text is empty");
  }
  const url = `https://partner-api.yelp.com/reviews/v1/${encodeURIComponent(reviewId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      response_text: trimmed,
      response_type: "public_comment",
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { description?: string; message?: string } };
      msg = json.error?.description ?? json.error?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}
