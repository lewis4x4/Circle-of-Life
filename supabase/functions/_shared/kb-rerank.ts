/**
 * kb-rerank — engine selection for the KB retrieval final pass.
 *
 * `KB_RERANK_ENGINE` picks the reranker; default is `cohere`, so nothing
 * changes until it is set.
 *
 *   cohere   (default) — Cohere rerank-v3.5, one call over all candidates.
 *   typesafe           — TypeSafe System One, one Noul per (query, candidate)
 *                        pair. Falls through to Cohere when it declines or
 *                        fails, and Cohere itself falls through to RRF order.
 *
 * The fallback chain never returns a degraded ranking: every stage either
 * produces a full ordering or hands the whole job to the next one. RRF order
 * is the floor and is already strong.
 */

import { rerankWithCohere, type RerankCandidate, type RerankOptions } from "./cohere-rerank.ts";
import { rerankWithTypeSafe, type TypeSafeRerankOptions } from "./typesafe-rerank.ts";

export type RerankEngine = "cohere" | "typesafe";

export type KbRerankOptions = RerankOptions &
  TypeSafeRerankOptions & {
    /** Overrides `KB_RERANK_ENGINE`. The eval harness sets this per run. */
    engine?: RerankEngine;
  };

export function resolveRerankEngine(explicit?: RerankEngine): RerankEngine {
  if (explicit) return explicit;
  return Deno.env.get("KB_RERANK_ENGINE") === "typesafe" ? "typesafe" : "cohere";
}

export async function rerankEvidence<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  options: KbRerankOptions = {},
): Promise<T[]> {
  if (resolveRerankEngine(options.engine) === "typesafe") {
    const ranked = await rerankWithTypeSafe(query, candidates, options);
    if (ranked) return ranked;
    // Declined (no key, PHI suspected) or failed past its tolerance.
    options.onWarn?.("kb_rerank_engine_fallback", { to: "cohere" });
  }
  return await rerankWithCohere(query, candidates, options);
}
