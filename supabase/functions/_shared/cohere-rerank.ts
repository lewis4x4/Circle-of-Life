/**
 * cohere-rerank — final-pass reranker for KB hybrid retrieval (KB-NEXT-05).
 *
 * After RRF fusion (retrieve_evidence_hybrid_v2) hands back a top-K of
 * candidates, this helper sends them to Cohere's /v1/rerank with the user's
 * original question. Cohere returns a relevance_score for each candidate;
 * we resort the array by that score and trim to `topN`.
 *
 * Behaviour:
 *   - If COHERE_API_KEY is unset, returns the input array unchanged (no-op).
 *     This means RRF order is the fallback, which is already strong.
 *   - If Cohere errors out, returns the input array unchanged AND surfaces a
 *     structured warning via the caller's logger callback.
 *   - Trims to topN even on the no-op path so callers don't have to.
 *   - Cost cap: never sends more than MAX_CANDIDATES_PER_CALL (default 50) —
 *     RRF already trims to <= match_count * 4 (typically <= 32) so this is
 *     defense in depth.
 */

const COHERE_API_URL = "https://api.cohere.ai/v1/rerank";
const COHERE_MODEL = "rerank-v3.5";
const MAX_CANDIDATES_PER_CALL = 50;
const REQUEST_TIMEOUT_MS = 8_000;

export interface RerankCandidate {
  excerpt: string;
  source_title: string;
  // anything else is preserved on the returned object via spread
  [k: string]: unknown;
}

export interface RerankOptions {
  apiKey?: string | null;
  topN?: number;
  /** Optional callback for non-fatal warnings (e.g. timeout, 5xx). */
  onWarn?: (msg: string, meta?: Record<string, unknown>) => void;
}

interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
  message?: string;
}

/**
 * Reranks `candidates` by relevance to `query` using Cohere /v1/rerank.
 * Falls back to the input order if Cohere is unavailable.
 */
export async function rerankWithCohere<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  options: RerankOptions = {},
): Promise<T[]> {
  const topN = Math.max(1, options.topN ?? candidates.length);
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return candidates.slice(0, topN);

  const apiKey = options.apiKey ?? Deno.env.get("COHERE_API_KEY");
  if (!apiKey) {
    return candidates.slice(0, topN);
  }

  const trimmed = candidates.slice(0, MAX_CANDIDATES_PER_CALL);

  const docs = trimmed.map((c) => {
    const title = String(c.source_title ?? "").trim();
    const excerpt = String(c.excerpt ?? "").trim();
    return title.length > 0 ? `${title}\n\n${excerpt}` : excerpt;
  });

  let payload: CohereRerankResponse;
  try {
    const res = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        query,
        documents: docs,
        top_n: Math.min(topN, trimmed.length),
        return_documents: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      options.onWarn?.("cohere_rerank_http_error", {
        status: res.status,
        body: errBody.slice(0, 300),
      });
      return candidates.slice(0, topN);
    }
    payload = (await res.json()) as CohereRerankResponse;
  } catch (err) {
    options.onWarn?.("cohere_rerank_threw", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return candidates.slice(0, topN);
  }

  const ranked = (payload.results ?? [])
    .filter((r) => typeof r.index === "number" && r.index >= 0 && r.index < trimmed.length)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, topN)
    .map((r) => trimmed[r.index]);

  if (ranked.length === 0) {
    options.onWarn?.("cohere_rerank_empty_results");
    return candidates.slice(0, topN);
  }

  return ranked;
}
