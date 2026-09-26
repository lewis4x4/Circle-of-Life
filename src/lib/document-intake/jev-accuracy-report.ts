/**
 * jev-accuracy-report: turns rows of the two accuracy views (migration 560)
 * into the three tiers of /admin/document-intake/accuracy (COL-771, DI-10).
 *
 * Pure: no reads, no writes. The recommendation math lives in jev-accuracy.ts;
 * this module only groups, counts and labels. Numbers are strictly per
 * questions_version: a type whose question set changed reports only its
 * current version (the version of its most recently approved Jev run) and
 * says how many older-version documents it left out.
 */
import {
  MARGIN_OFF,
  MARGIN_STEPS,
  recommendCheck,
  recommendMargin,
  wilsonLower,
  type CheckRecommendation,
  type CheckRow,
  type OutcomeRow,
  type Recommendation,
} from "./jev-accuracy";

/** One row of public.document_intake_jev_outcomes, as the page selects it. */
export type JevOutcomeViewRow = {
  filing_id: string;
  item_id: string;
  approved_at: string;
  proposed_code: string | null;
  filed_code: string;
  type_correct: boolean;
  jev_state: string;
  questions_version: string | null;
  jev_choice: string | null;
  jev_margin: number | null;
  margin_at_run: number | null;
  jev_top_correct: boolean | null;
};

/** One row of public.document_intake_jev_check_outcomes, as the page selects it. */
export type JevCheckViewRow = {
  filing_id: string;
  item_id: string;
  approved_at: string;
  filed_code: string;
  questions_version: string | null;
  check_code: string;
  check_label: string | null;
  jev_result: string | null;
  verdict: string | null;
};

// ── Window ──────────────────────────────────────────────────────────────────

export const ACCURACY_WINDOWS = [
  { key: "14", label: "14 days", days: 14 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;
export type AccuracyWindow = (typeof ACCURACY_WINDOWS)[number]["key"];
export const DEFAULT_ACCURACY_WINDOW: AccuracyWindow = "30";

export function parseAccuracyWindow(value: string | null | undefined): AccuracyWindow {
  return ACCURACY_WINDOWS.find((w) => w.key === value)?.key ?? DEFAULT_ACCURACY_WINDOW;
}

/** ISO lower bound on approved_at for the window, or null for all time. */
export function windowStartIso(window: AccuracyWindow, now: number): string | null {
  const days = ACCURACY_WINDOWS.find((w) => w.key === window)?.days ?? null;
  return days == null ? null : new Date(now - days * 86_400_000).toISOString();
}

// ── Margin now ──────────────────────────────────────────────────────────────

/** Same fallback as the processor's DEFAULT_JEV_MARGIN. */
export const DEFAULT_JEV_MARGIN = 0.2;

function isMargin(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The live margin for one type from `routing_json.document_intake`: per type,
 * then global, then the default. Out-of-range values fall through, exactly as
 * the processor resolves it.
 */
export function marginFromRouting(documentIntake: unknown, code: string): number {
  const routing = isRecord(documentIntake) ? documentIntake : {};
  const byType = routing.jev_margin_by_type;
  if (isRecord(byType) && Object.hasOwn(byType, code) && isMargin(byType[code])) return byType[code];
  if (isMargin(routing.jev_margin)) return routing.jev_margin;
  return DEFAULT_JEV_MARGIN;
}

/** `policy`: read from the live setting. `last_run`: the setting could not be read; this is what the latest run used. */
export type MarginNow = { value: number; source: "policy" | "last_run" };

// ── Text ────────────────────────────────────────────────────────────────────

/** 0.1, 0.15, 1: at most four decimals, no trailing zeros. */
export function formatMargin(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Aggregate accuracy only, never a single answer. Rounded down so a bound never reads better than it is. */
export function formatShare(value: number | null): string {
  if (value == null) return "Not enough yet";
  return `${Math.floor(value * 1000 + 1e-9) / 10}%`;
}

export function recommendationLabel(rec: Recommendation): string {
  switch (rec.action) {
    case "collect":
      return `Collect ${rec.evaluated} of ${rec.needed}`;
    case "keep":
      return "Keep";
    case "loosen":
      return `Loosen to ${formatMargin(rec.to)}`;
    case "tighten":
      return `Tighten to ${formatMargin(rec.to)}`;
    case "off":
      return "Off";
  }
}

/** The margin a recommendation asks for, or null when the setting should stay as it is. */
export function recommendedMargin(rec: Recommendation): number | null {
  if (rec.action === "loosen" || rec.action === "tighten") return rec.to;
  if (rec.action === "off") return MARGIN_OFF;
  return null;
}

const CATALOG_CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * The statement Brian runs to apply a margin. The page never writes the
 * setting; it renders this for copying. The code is validated before it is
 * interpolated and the value must be a margin in [0, 1].
 */
export function marginSettingSql(code: string, value: number): string {
  if (!CATALOG_CODE_RE.test(code)) throw new Error("Not a catalog code");
  if (!isMargin(value)) throw new Error("A margin is between 0 and 1");
  return [
    "update public.ai_invocation_policies",
    "set routing_json = jsonb_set(",
    "  routing_json, '{document_intake,jev_margin_by_type}',",
    `  coalesce(routing_json->'document_intake'->'jev_margin_by_type', '{}'::jsonb) || jsonb_build_object('${code}', ${formatMargin(value)}),`,
    "  true)",
    "where organization_id = '00000000-0000-0000-0000-000000000001';",
  ].join("\n");
}

// ── Tiers ───────────────────────────────────────────────────────────────────

export type TypeSummary = {
  code: string;
  label: string;
  /** Documents of this type filed in the window, any question set. */
  filed: number;
  /** Jev ran on the current question set. */
  jevRan: number;
  /** Top pick right, k of n, on the current question set. */
  right: number;
  evaluated: number;
  lowerBound: number | null;
  questionsVersion: string | null;
  /** Jev runs on an older question set, left out of every number here. */
  excludedOlder: number;
  marginNow: MarginNow;
  recommendation: Recommendation;
};

export type MarginStepRow = { margin: number; cleared: number; right: number; accuracy: number | null; lowerBound: number | null; current: boolean };

export type CheckSummary = CheckRecommendation & { code: string; label: string };

export type TypeDetail = {
  code: string;
  margins: MarginStepRow[];
  checks: CheckSummary[];
  /** Setting change text, when the recommendation changes the margin. */
  sql: string | null;
};

export type MissReason = "top_pick" | "check";

export type Miss = {
  filingId: string;
  itemId: string;
  approvedAt: string;
  code: string;
  label: string;
  jevChoice: string | null;
  /** The filing's destination_kind, when it was read. */
  destinationKind: string | null;
  reasons: MissReason[];
  /** Labels of checks a reviewer marked Wrong. */
  wrongChecks: string[];
};

export type AccuracyReport = {
  readerAgreement: { agree: number; total: number };
  types: TypeSummary[];
  details: Record<string, TypeDetail>;
  misses: Miss[];
};

export type ReportInput = {
  outcomes: JevOutcomeViewRow[];
  checks: JevCheckViewRow[];
  catalogLabels: Record<string, string>;
  /** `routing_json.document_intake` when the viewer may read it; null otherwise. */
  documentIntakeRouting: unknown | null;
  /** destination_kind per filing id, for the misses. */
  destinationKinds?: Record<string, string>;
};

const JEV_ACTIVITY = new Set(["ran", "failed"]);

function newestFirst<T extends { approved_at: string }>(a: T, b: T): number {
  return a.approved_at < b.approved_at ? 1 : a.approved_at > b.approved_at ? -1 : 0;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function toCheckRow(row: JevCheckViewRow): CheckRow | null {
  if (row.jev_result !== "pass" && row.jev_result !== "fail" && row.jev_result !== "unknown") return null;
  const verdict = row.verdict === "right" || row.verdict === "wrong" || row.verdict === "cant_tell" ? row.verdict : null;
  return { jev_result: row.jev_result, verdict };
}

function marginSteps(rows: OutcomeRow[], current: number): MarginStepRow[] {
  return MARGIN_STEPS.map((margin) => {
    const cleared = rows.filter((r) => r.jev_margin > margin);
    const right = cleared.filter((r) => r.jev_top_correct).length;
    return {
      margin,
      cleared: cleared.length,
      right,
      accuracy: cleared.length ? right / cleared.length : null,
      lowerBound: cleared.length ? wilsonLower(right, cleared.length) : null,
      current: margin === current,
    };
  });
}

function checkSummaries(rows: JevCheckViewRow[]): CheckSummary[] {
  return [...groupBy(rows, (r) => r.check_code)]
    .map(([code, list]) => {
      const label = [...list].sort(newestFirst).find((r) => r.check_label)?.check_label ?? code;
      const rec = recommendCheck(list.map(toCheckRow).filter((r): r is CheckRow => r !== null));
      return { code, label, ...rec };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function summarizeType(code: string, label: string, outcomes: JevOutcomeViewRow[], checks: JevCheckViewRow[], routing: unknown | null) {
  const active = outcomes.filter((r) => JEV_ACTIVITY.has(r.jev_state)).sort(newestFirst);
  const questionsVersion = active.find((r) => r.jev_state === "ran" && r.questions_version)?.questions_version ?? active[0]?.questions_version ?? null;
  const current = active.filter((r) => r.questions_version === questionsVersion);
  const ran = current.filter((r) => r.jev_state === "ran");
  const evaluated: OutcomeRow[] = ran.flatMap((r) =>
    r.jev_top_correct == null || r.jev_margin == null ? [] : [{ jev_margin: Number(r.jev_margin), jev_top_correct: r.jev_top_correct }],
  );
  const right = evaluated.filter((r) => r.jev_top_correct).length;
  const lastRun = ran[0]?.margin_at_run;
  const marginNow: MarginNow =
    routing != null ? { value: marginFromRouting(routing, code), source: "policy" } : { value: isMargin(lastRun) ? lastRun : DEFAULT_JEV_MARGIN, source: "last_run" };
  const recommendation = recommendMargin(evaluated, marginNow.value);
  const target = recommendedMargin(recommendation);

  const summary: TypeSummary = {
    code,
    label,
    filed: outcomes.length,
    jevRan: ran.length,
    right,
    evaluated: evaluated.length,
    lowerBound: evaluated.length ? wilsonLower(right, evaluated.length) : null,
    questionsVersion,
    excludedOlder: active.length - current.length,
    marginNow,
    recommendation,
  };
  const detail: TypeDetail = {
    code,
    margins: marginSteps(evaluated, marginNow.value),
    checks: checkSummaries(checks.filter((r) => r.questions_version === questionsVersion)),
    sql: target != null && CATALOG_CODE_RE.test(code) ? marginSettingSql(code, target) : null,
  };
  return { summary, detail };
}

export function buildAccuracyReport(input: ReportInput): AccuracyReport {
  const { outcomes, checks, catalogLabels, documentIntakeRouting, destinationKinds = {} } = input;
  const labelFor = (code: string) => catalogLabels[code] ?? code;

  const outcomesByType = groupBy(outcomes, (r) => r.filed_code);
  const checksByType = groupBy(checks, (r) => r.filed_code);
  const types: TypeSummary[] = [];
  const details: Record<string, TypeDetail> = {};
  for (const [code, rows] of outcomesByType) {
    if (!rows.some((r) => JEV_ACTIVITY.has(r.jev_state))) continue;
    const { summary, detail } = summarizeType(code, labelFor(code), rows, checksByType.get(code) ?? [], documentIntakeRouting);
    types.push(summary);
    details[code] = detail;
  }
  types.sort((a, b) => b.filed - a.filed || a.label.localeCompare(b.label));

  const wrongChecks = groupBy(
    checks.filter((r) => r.verdict === "wrong"),
    (r) => r.filing_id,
  );
  const missed = new Map<string, Miss>();
  for (const row of outcomes) {
    const topPickWrong = row.jev_top_correct === false;
    const wrong = wrongChecks.get(row.filing_id) ?? [];
    if (!topPickWrong && wrong.length === 0) continue;
    missed.set(row.filing_id, {
      filingId: row.filing_id,
      itemId: row.item_id,
      approvedAt: row.approved_at,
      code: row.filed_code,
      label: labelFor(row.filed_code),
      jevChoice: row.jev_choice,
      destinationKind: destinationKinds[row.filing_id] ?? null,
      reasons: [...(topPickWrong ? (["top_pick"] as const) : []), ...(wrong.length ? (["check"] as const) : [])],
      wrongChecks: wrong.map((r) => r.check_label ?? r.check_code),
    });
  }
  // A Wrong verdict whose outcome fell outside what was read still counts as a miss.
  for (const [filingId, wrong] of wrongChecks) {
    if (missed.has(filingId)) continue;
    const first = wrong[0];
    missed.set(filingId, {
      filingId,
      itemId: first.item_id,
      approvedAt: first.approved_at,
      code: first.filed_code,
      label: labelFor(first.filed_code),
      jevChoice: null,
      destinationKind: destinationKinds[filingId] ?? null,
      reasons: ["check"],
      wrongChecks: wrong.map((r) => r.check_label ?? r.check_code),
    });
  }
  const misses = [...missed.values()].sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : a.approvedAt > b.approvedAt ? -1 : 0));

  return {
    readerAgreement: { agree: outcomes.filter((r) => r.type_correct).length, total: outcomes.length },
    types,
    details,
    misses,
  };
}
