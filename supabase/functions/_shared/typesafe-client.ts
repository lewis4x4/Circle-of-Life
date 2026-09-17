/**
 * typesafe-client — minimal HTTP client for the TypeSafe System One endpoint.
 *
 * System One models (Jev) answer typed questions about a piece of state and
 * return the answer plus a calibrated probability distribution. There is no
 * free-text generation and therefore no JSON to parse out of prose: the
 * response shape is the contract.
 *
 * Deliberately raw `fetch`, no SDK. Every other external call in this
 * directory (Anthropic in `router-intent.ts`, Cohere in `cohere-rerank.ts`)
 * is raw fetch, and an esm.sh dependency inside an Edge Function is cold-start
 * cost we do not need for one POST.
 *
 * Not implemented on purpose:
 *   - Retries. Callers here sit inside a 5s interactive budget; a backoff
 *     would spend the whole budget. `kind` is reported so the caller can
 *     choose its own fallback instead.
 *   - Streaming. Answers are small and arrive whole.
 */

const TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 5_000;

/** Structured criteria/instructions. The API accepts a string or nested JSON. */
export type Description = string | Record<string, unknown> | unknown[];

export type NoulQuestion = {
  type: "noul";
  instructions: Description;
  /** What a yes means and what a no means. */
  criteria: { true: Description; false: Description };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: Description;
  /** Option key → what distinguishes that option from its peers. */
  criteria: Record<string, Description>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: Description;
  /** Ordered levels, lowest first. Each must stand on its own. */
  criteria: Description[];
};

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type SystemOneAnswer = {
  type: "noul" | "choice" | "score";
  /** Probability of yes. Present on noul answers. A noul has no `confidence`. */
  noul?: number;
  /** Winning option key. Present on choice answers. */
  choice?: string;
  /** Probability-weighted position across the levels. Present on score answers. */
  score?: number;
  /** Full distribution; sums to 1. Present on choice and score answers. */
  probabilities?: Record<string, number>;
  /**
   * How concentrated `probabilities` is — NOT how likely the answer is to be
   * correct, and not permission to act. Present on choice and score answers.
   */
  confidence?: number;
  legend?: Record<string, unknown>;
};

export type SystemOneResponse = {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type TypeSafeErrorKind =
  /** 401 — key missing, revoked, or wrong. Will not fix itself; do not retry. */
  | "unauthorized"
  /** 422 — we built a bad request. A code bug, not a runtime condition. */
  | "malformed_request"
  /** 429 — rate limited. */
  | "rate_limited"
  /** 529 — service overloaded. */
  | "overloaded"
  /** Any other non-2xx. */
  | "http_error"
  /** DNS, TLS, timeout, abort. */
  | "transport"
  /** 2xx whose body was not the documented shape. */
  | "malformed_response";

export class TypeSafeError extends Error {
  readonly kind: TypeSafeErrorKind;
  readonly status?: number;

  constructor(kind: TypeSafeErrorKind, message: string, status?: number) {
    super(message);
    this.name = "TypeSafeError";
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status: number): TypeSafeErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 422) return "malformed_request";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  return "http_error";
}

export type EvaluateArgs = {
  apiKey: string;
  /** The content to judge. Prefer named JSON fields when it has several parts. */
  state: string | Record<string, unknown> | unknown[];
  /** Question id → question. Ids are for code; the model never sees them. */
  questions: Record<string, SystemOneQuestion>;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

/**
 * POST one batch of questions about one state.
 *
 * Questions in a single call run in parallel and cannot see one another's
 * answers, so decomposing a judgment into several narrow questions costs one
 * round trip, not several. Ask everything that depends only on this state here
 * — including speculative questions whose answers code may discard.
 *
 * Throws `TypeSafeError` on every failure path so the caller can branch on
 * `kind`; it never returns a partial or synthesized answer.
 */
export async function evaluateSystemOne(args: EvaluateArgs): Promise<SystemOneResponse> {
  const {
    apiKey,
    state,
    questions,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetcher = fetch,
  } = args;

  if (!apiKey) {
    throw new TypeSafeError("unauthorized", "TypeSafe API key is empty");
  }
  if (Object.keys(questions).length === 0) {
    throw new TypeSafeError("malformed_request", "No questions supplied");
  }

  let response: Response;
  try {
    response = await fetcher(TYPESAFE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TypeSafeError("transport", `TypeSafe request failed: ${String(err)}`);
  }

  if (!response.ok) {
    // Drain the body so the connection can be reused, but never surface it:
    // the state we send can carry an operator's question verbatim, and error
    // bodies get logged. `kind` and `status` are the whole diagnostic.
    await response.text().catch(() => "");
    throw new TypeSafeError(
      kindForStatus(response.status),
      `TypeSafe returned ${response.status}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TypeSafeError("malformed_response", "TypeSafe response was not JSON");
  }

  if (!payload || typeof payload !== "object") {
    throw new TypeSafeError("malformed_response", "TypeSafe response was not an object");
  }
  const answers = (payload as Record<string, unknown>).answers;
  if (!answers || typeof answers !== "object") {
    throw new TypeSafeError("malformed_response", "TypeSafe response had no answers");
  }

  return payload as SystemOneResponse;
}

/**
 * Read a choice answer, or throw. Used instead of optional chaining so a
 * missing answer fails loudly at the seam rather than silently becoming a
 * default several layers later.
 */
export function requireChoice(
  response: SystemOneResponse,
  id: string,
): { choice: string; probabilities: Record<string, number>; confidence: number } {
  const answer = response.answers[id];
  if (!answer || typeof answer.choice !== "string") {
    throw new TypeSafeError("malformed_response", `Missing choice answer '${id}'`);
  }
  return {
    choice: answer.choice,
    probabilities: answer.probabilities ?? {},
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
  };
}

/** Read a noul answer's probability of yes, or throw. */
export function requireNoul(response: SystemOneResponse, id: string): number {
  const answer = response.answers[id];
  if (!answer || typeof answer.noul !== "number") {
    throw new TypeSafeError("malformed_response", `Missing noul answer '${id}'`);
  }
  return answer.noul;
}

/**
 * Read a score answer, or throw.
 *
 * `score` is a probability-weighted position across the levels, not an index:
 * a 3-level question can answer 1.4. Compare scores against each other or
 * against a threshold; do not round one to look up a level name.
 */
export function requireScore(
  response: SystemOneResponse,
  id: string,
): { score: number; probabilities: Record<string, number>; confidence: number } {
  const answer = response.answers[id];
  if (!answer || typeof answer.score !== "number") {
    throw new TypeSafeError("malformed_response", `Missing score answer '${id}'`);
  }
  return {
    score: answer.score,
    probabilities: answer.probabilities ?? {},
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
  };
}
