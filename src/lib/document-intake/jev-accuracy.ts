/**
 * jev-accuracy: per-type margin recommendation for Document Intake (COL-771, DI-10).
 *
 * Input: rows of public.document_intake_jev_outcomes for one catalog type and
 * one questions_version, where Jev ran and jev_top_correct is not null.
 * Output: a recommendation a person applies by editing
 * ai_invocation_policies.routing_json.document_intake.jev_margin_by_type.
 * Nothing here changes a setting.
 *
 * Why these numbers: every filing still needs a person, but a pre-selected
 * resident invites a click-through, and a misfiled resident document is a
 * privacy incident. So loosening needs a Wilson 95% lower bound of 0.90 on at
 * least 30 cleared documents (in practice 34 or more in a row with no miss),
 * and any observed accuracy under 0.95 at the current margin tightens it.
 */

export const MARGIN_STEPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6] as const;
export const MIN_EVALUATED = 30;
export const LOOSEN_MIN_CLEARED = 30;
export const LOOSEN_LOWER_BOUND = 0.9;
/** The documents a lower margin would newly admit must themselves be this good. */
export const LOOSEN_BAND_MIN = 10;
export const LOOSEN_BAND_ACCURACY = 0.95;
export const TIGHTEN_BELOW_ACCURACY = 0.95;
export const TIGHTEN_MIN_CLEARED = 10;
/** A margin of 1 can never be cleared: Jev pre-selects nothing, still answers. */
export const MARGIN_OFF = 1;

export type OutcomeRow = { jev_margin: number; jev_top_correct: boolean };

export type Recommendation =
  | { action: "collect"; evaluated: number; needed: number }
  | { action: "keep"; margin: number; accuracy: number; lower_bound: number; cleared: number }
  | { action: "loosen" | "tighten"; from: number; to: number; accuracy: number; lower_bound: number; cleared: number }
  | { action: "off"; from: number; reason: string };

export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

function cleared(rows: OutcomeRow[], margin: number) {
  const s = rows.filter((r) => r.jev_margin > margin);
  const k = s.filter((r) => r.jev_top_correct).length;
  return { n: s.length, k, accuracy: s.length ? k / s.length : 0, lower: wilsonLower(k, s.length) };
}

export function recommendMargin(rows: OutcomeRow[], current: number): Recommendation {
  if (rows.length < MIN_EVALUATED) return { action: "collect", evaluated: rows.length, needed: MIN_EVALUATED };
  const now = cleared(rows, current);
  if (now.n >= TIGHTEN_MIN_CLEARED && now.accuracy < TIGHTEN_BELOW_ACCURACY) {
    const stricter = MARGIN_STEPS.filter((m) => m > current)
      .map((m) => ({ m, ...cleared(rows, m) }))
      .find((x) => x.n >= TIGHTEN_MIN_CLEARED && x.accuracy >= TIGHTEN_BELOW_ACCURACY);
    if (!stricter) return { action: "off", from: current, reason: "No margin reaches 95% on 10 or more documents. Fix the destination question." };
    return { action: "tighten", from: current, to: stricter.m, accuracy: stricter.accuracy, lower_bound: stricter.lower, cleared: stricter.n };
  }
  // Step down one margin at a time. The band a lower margin newly admits,
  // (m, current], must hold up on its own; a failing band stops the walk. A
  // step is only recommended when documents actually landed in its slice.
  let looser: ({ m: number } & ReturnType<typeof cleared>) | null = null;
  let upper = current;
  for (const m of MARGIN_STEPS.filter((x) => x < current).sort((a, b) => b - a)) {
    const all = cleared(rows, m);
    const band = rows.filter((r) => r.jev_margin > m && r.jev_margin <= current);
    const slice = rows.filter((r) => r.jev_margin > m && r.jev_margin <= upper);
    upper = m;
    if (band.length >= LOOSEN_BAND_MIN && band.filter((r) => r.jev_top_correct).length / band.length < LOOSEN_BAND_ACCURACY) break;
    if (band.length < LOOSEN_BAND_MIN || all.n < LOOSEN_MIN_CLEARED || all.lower < LOOSEN_LOWER_BOUND || slice.length === 0) continue;
    looser = { m, ...all };
  }
  if (looser) return { action: "loosen", from: current, to: looser.m, accuracy: looser.accuracy, lower_bound: looser.lower, cleared: looser.n };
  return { action: "keep", margin: current, accuracy: now.accuracy, lower_bound: now.lower, cleared: now.n };
}

// ── Checks ──────────────────────────────────────────────────────────────────

export const CHECK_MIN_RATED = 20;
export const CHECK_MAX_UNKNOWN_SHARE = 0.3;
export const CHECK_MIN_RIGHT_RATE = 0.8;

export type CheckRow = { jev_result: "pass" | "fail" | "unknown"; verdict: "right" | "wrong" | "cant_tell" | null };

export type CheckRecommendation = {
  action: "collect" | "keep" | "reword";
  answered: number;
  rated: number;
  right_rate: number | null;
  unknown_share: number;
  reason: string;
};

/**
 * One Jev check on one type and questions_version. `rated` counts reviewer
 * verdicts of right or wrong; "can't tell" is neither. A question Jev keeps
 * answering "unknown" is as broken as one it answers wrong.
 */
export function recommendCheck(rows: CheckRow[]): CheckRecommendation {
  const answered = rows.length;
  const unknownShare = answered ? rows.filter((r) => r.jev_result === "unknown").length / answered : 0;
  const rated = rows.filter((r) => r.verdict === "right" || r.verdict === "wrong");
  const right = rated.filter((r) => r.verdict === "right").length;
  const rightRate = rated.length ? right / rated.length : null;
  if (answered >= CHECK_MIN_RATED && unknownShare > CHECK_MAX_UNKNOWN_SHARE) {
    return { action: "reword", answered, rated: rated.length, right_rate: rightRate, unknown_share: unknownShare, reason: "Jev lands in the unsure band too often. Sharpen the criteria or the evidence the reader copies." };
  }
  if (rated.length < CHECK_MIN_RATED) {
    return { action: "collect", answered, rated: rated.length, right_rate: rightRate, unknown_share: unknownShare, reason: `${rated.length} of ${CHECK_MIN_RATED} reviewer verdicts so far.` };
  }
  if ((rightRate ?? 0) < CHECK_MIN_RIGHT_RATE) {
    return { action: "reword", answered, rated: rated.length, right_rate: rightRate, unknown_share: unknownShare, reason: "Reviewers overrule Jev too often. Reword the question or move its band." };
  }
  return { action: "keep", answered, rated: rated.length, right_rate: rightRate, unknown_share: unknownShare, reason: "Holding up." };
}
