/**
 * typesafe-rerank — TypeSafe System One reranker for KB hybrid retrieval.
 *
 * Alternative final pass to `cohere-rerank.ts`, same signature and same
 * fallback contract, so `knowledge-agent` changes at one call site.
 *
 * Shape follows TypeSafe's own reranking recipe rather than Cohere's: one
 * call per (query, candidate) PAIR, asking a single Noul, run concurrently.
 * Batching every candidate into one state would be one round trip instead of
 * N, but it is the wrong trade here for two reasons:
 *
 *   1. Probabilities stop being comparable. The whole point of a rerank is
 *      ordering candidates against each other, and a noul answered about
 *      `candidates[7]` inside a 32-passage state is not calibrated against
 *      one answered about `candidates[3]` in the same breath.
 *   2. Each passage gets the model's undivided attention on one question.
 *
 * The published recipe measures 5% -> 18% top-1 on legal retrieval this way,
 * at $0.065 for 1,200 calls, so the per-pair cost is not the constraint.
 *
 * PHI: the CANDIDATES are knowledge-base content (policies, AHCA regulations)
 * and carry no resident data. The QUERY is operator free text and can name a
 * resident even on a policy question ("what does our policy say about John's
 * wandering"). `phiSuspected` exists for that and is the caller's judgment to
 * pass, not this module's to infer — see COL-466.
 */

import {
  TypeSafeError,
  evaluateSystemOne,
  requireNoul,
  type SystemOneQuestion,
} from "./typesafe-client.ts";
import type { RerankCandidate, RerankOptions } from "./cohere-rerank.ts";

/** Matches the Cohere path's cap. RRF already trims to ~32. */
const MAX_CANDIDATES_PER_CALL = 50;

/** Per-pair budget. Pairs run concurrently, so this is not multiplied by N. */
const PAIR_TIMEOUT_MS = 6_000;

/** The cookbook's worker count. Enough to hide latency, low enough to avoid 429. */
const DEFAULT_CONCURRENCY = 12;

/**
 * Abandon the rerank entirely above this failure ratio. A mostly-failed rerank
 * is a silently degraded one, and RRF order is already strong — better to
 * return it honestly than to ship a ranking built from a third of the evidence.
 */
const MAX_FAILURE_RATIO = 0.25;

const RELEVANCE_QUESTION: SystemOneQuestion = {
  type: "noul",
  instructions: {
    question:
      "Does this passage contain what someone asking the question needs in order to answer it?",
    inspect: "`candidate_passage`",
    focus:
      "Whether the passage supplies the specific provision, threshold, procedure, or definition the question reaches for.",
    note:
      "Judge only this passage. Do not reward it for being about the right general subject, and do not penalise it for failing to answer parts of the question it was never about.",
  },
  criteria: {
    true: {
      what:
        "The passage states the specific rule, number, step, or definition the question asks for, such that quoting it would answer the question.",
      examples: [
        "Question asks the med-error reporting window; passage states the window.",
        "Question asks who must sign a 1823; passage names the signatory.",
      ],
    },
    false: {
      what:
        "The passage is on a related topic, or mentions the subject in passing, but does not supply the thing asked for.",
      examples: [
        "Question asks the reporting window; passage says errors must be reported, without saying when.",
        "Passage is a table of contents, header, or cross-reference to the real provision.",
      ],
    },
  },
};

export type TypeSafeRerankOptions = RerankOptions & {
  /** Overrides TYPESAFE_API_KEY. */
  typeSafeApiKey?: string | null;
  concurrency?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /**
   * True when the query may contain resident-identifying text. Set it and this
   * module refuses to send anything, returning null so the caller falls back.
   * Never inferred here: the caller has the router's classification and this
   * module only has a string.
   */
  phiSuspected?: boolean;
};

function candidateState(query: string, candidate: RerankCandidate) {
  const title = String(candidate.source_title ?? "").trim();
  const section = String(candidate.section_title ?? "").trim();
  return {
    question: query,
    candidate_passage: {
      ...(title ? { source_title: title } : {}),
      ...(section ? { section_title: section } : {}),
      text: String(candidate.excerpt ?? "").trim(),
    },
  };
}

/** Run `task` over `items` with at most `limit` in flight. Order is preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(Math.max(1, limit), items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await task(items[index], index);
      }
    });
  await Promise.all(workers);
  return results;
}

/**
 * Rerank `candidates` by relevance to `query`.
 *
 * Returns `null` rather than a degraded ordering when it declines or fails
 * wholesale, so the caller can fall through to Cohere or to RRF order. It
 * never returns a partially-scored list disguised as a ranking.
 */
export async function rerankWithTypeSafe<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  options: TypeSafeRerankOptions = {},
): Promise<T[] | null> {
  const topN = Math.max(1, options.topN ?? candidates.length);
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return candidates.slice(0, topN);

  if (options.phiSuspected) {
    options.onWarn?.("typesafe_rerank_skipped", { reason: "phi_suspected" });
    return null;
  }

  const apiKey = options.typeSafeApiKey ?? Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) return null;

  const trimmed = candidates.slice(0, MAX_CANDIDATES_PER_CALL);

  const scores = await mapWithConcurrency(
    trimmed,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (candidate) => {
      try {
        const response = await evaluateSystemOne({
          apiKey,
          state: candidateState(query, candidate),
          questions: { answers_the_question: RELEVANCE_QUESTION },
          timeoutMs: options.timeoutMs ?? PAIR_TIMEOUT_MS,
          fetcher: options.fetcher,
        });
        return requireNoul(response, "answers_the_question");
      } catch (err) {
        options.onWarn?.("typesafe_rerank_pair_failed", {
          error_code: err instanceof TypeSafeError ? err.kind : "unknown",
          status: err instanceof TypeSafeError ? err.status ?? null : null,
        });
        return null;
      }
    },
  );

  const failures = scores.filter((s) => s === null).length;
  if (failures / trimmed.length > MAX_FAILURE_RATIO) {
    options.onWarn?.("typesafe_rerank_abandoned", {
      failed: failures,
      total: trimmed.length,
    });
    return null;
  }

  // Scored candidates by descending probability. Ties and unscored candidates
  // keep their incoming RRF order, which is a real signal, not an arbitrary one.
  const scored = trimmed
    .map((candidate, index) => ({ candidate, index, score: scores[index] }))
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score! - a.score!) || (a.index - b.index));

  const unscored = trimmed
    .map((candidate, index) => ({ candidate, index, score: scores[index] }))
    .filter((row) => row.score === null);

  return [...scored, ...unscored].slice(0, topN).map((row) => row.candidate);
}
