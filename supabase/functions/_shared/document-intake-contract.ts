/**
 * Document Intake — Deno copy of the proposal result contract (COL-771, DI-04).
 *
 * `document_intake_worker_complete` stores whatever JSON the worker hands it,
 * so the worker validates its own result first. The source of truth is
 * `proposalResultSchema` in `src/lib/document-intake/contracts.ts` (zod, Node);
 * this file restates the same fields and enums without any import so both
 * Deno and vitest can load it, and `src/lib/document-intake/worker-contract.test.ts`
 * fails when the two drift.
 */

export const DOCUMENT_INTAKE_BUCKET = "document-intake";
export const DOCUMENT_INTAKE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const DOCUMENT_INTAKE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
] as const;
export type DocumentIntakeMime = (typeof DOCUMENT_INTAKE_MIME_TYPES)[number];

export const DESTINATION_KINDS = ["resident_document", "benefits_document", "employee_file", "facility_document"] as const;
export const CANDIDATE_KINDS = [...DESTINATION_KINDS, "none"] as const;
export const SUBJECT_KINDS = ["resident", "staff", "facility", "medicaid_case", "none"] as const;
export const PROPOSAL_OUTCOMES = ["proposed", "blocked", "skipped"] as const;
export const STAGE_STATES = ["ran", "not_authorized", "not_configured", "failed", "not_applicable", "skipped"] as const;
export const JEV_ANSWER_TYPES = ["noul", "choice", "score"] as const;
export const CHECK_RESULTS = ["pass", "fail", "unknown"] as const;
export const CHECK_SOURCES = ["code", "jev", "reader"] as const;

export const PROPOSAL_RESULT_FIELDS = [
  "outcome",
  "outcome_code",
  "processing_reason",
  "suggested_title",
  "summary",
  "summary_pages",
  "document_date",
  "catalog_code",
  "candidates",
  "proposed_candidate",
  "segments",
  "page_count",
  "reader",
  "jev",
  "checks",
  "warnings",
  "stage_status",
] as const;
export const CANDIDATE_FIELDS = ["kind", "catalog_code", "subject_id", "label", "reason", "requirement_id"] as const;
export const SEGMENT_FIELDS = ["pages", "catalog_code", "title"] as const;
export const CHECK_FIELDS = ["code", "label", "result", "detail", "source"] as const;
export const WARNING_FIELDS = ["code", "message"] as const;
export const STAGE_STATUS_FIELDS = ["state", "reason"] as const;
export const JEV_ANSWER_FIELDS = ["type", "choice", "noul", "score", "probabilities", "confidence"] as const;

export const LIMITS = {
  outcome_code: 120,
  processing_reason: 200,
  suggested_title: 200,
  summary: 600,
  segment_title: 200,
} as const;

export type StageState = (typeof STAGE_STATES)[number];
export type StageStatus = { state: StageState; reason?: string };

export type Candidate = {
  kind: (typeof CANDIDATE_KINDS)[number];
  catalog_code: string;
  subject_id: string | null;
  label: string;
  reason?: string;
  requirement_id?: string | null;
};

export type JevAnswer = {
  type: (typeof JEV_ANSWER_TYPES)[number];
  choice?: string;
  noul?: number;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  [extra: string]: unknown;
};

export type ProposalCheck = {
  code: string;
  label: string;
  result: (typeof CHECK_RESULTS)[number];
  detail?: string;
  source: (typeof CHECK_SOURCES)[number];
};

export type ProposalResult = {
  outcome: (typeof PROPOSAL_OUTCOMES)[number];
  outcome_code?: string;
  processing_reason?: string;
  suggested_title: string | null;
  summary: string | null;
  summary_pages: number[];
  document_date: string | null;
  catalog_code: string | null;
  candidates: Candidate[];
  proposed_candidate: number | null;
  segments: { pages: number[]; catalog_code: string | null; title: string | null }[];
  page_count: number | null;
  reader: {
    provider?: string;
    model?: string;
    prompt_hash?: string;
    response_hash?: string;
    subject_hints?: Record<string, unknown>;
    [extra: string]: unknown;
  };
  jev: {
    model?: string;
    questions_version?: string;
    answers?: Record<string, JevAnswer>;
    [extra: string]: unknown;
  };
  checks: ProposalCheck[];
  warnings: { code: string; message: string }[];
  stage_status: { reader: StageStatus; jev: StageStatus };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isInt(value: unknown, min: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}
function oneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}
function optionalString(value: unknown, max = Infinity): boolean {
  return value === undefined || (typeof value === "string" && value.length <= max);
}
function nullableString(value: unknown, max = Infinity): boolean {
  return value === null || (typeof value === "string" && value.length <= max);
}
function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Validate a result exactly as `proposalResultSchema.safeParse` would accept it
 * (after its defaults are applied). Returns the problems found; empty = valid.
 * The paths name fields only, never values, so they are safe to log.
 */
export function proposalResultProblems(value: unknown): string[] {
  const problems: string[] = [];
  const fail = (path: string) => problems.push(path);
  if (!isObject(value)) return ["result"];

  if (!oneOf(PROPOSAL_OUTCOMES, value.outcome)) fail("outcome");
  if (!optionalString(value.outcome_code, LIMITS.outcome_code)) fail("outcome_code");
  if (!optionalString(value.processing_reason, LIMITS.processing_reason)) fail("processing_reason");
  if (!nullableString(value.suggested_title, LIMITS.suggested_title)) fail("suggested_title");
  if (!nullableString(value.summary, LIMITS.summary)) fail("summary");
  if (!Array.isArray(value.summary_pages) || !value.summary_pages.every((p) => isInt(p, 1))) fail("summary_pages");
  if (!(value.document_date === null || (typeof value.document_date === "string" && DATE_RE.test(value.document_date)))) {
    fail("document_date");
  }
  if (!nullableString(value.catalog_code)) fail("catalog_code");

  if (!Array.isArray(value.candidates)) {
    fail("candidates");
  } else {
    value.candidates.forEach((c, i) => {
      if (!isObject(c)) return fail(`candidates.${i}`);
      if (!oneOf(CANDIDATE_KINDS, c.kind)) fail(`candidates.${i}.kind`);
      if (typeof c.catalog_code !== "string") fail(`candidates.${i}.catalog_code`);
      if (!(c.subject_id === null || (typeof c.subject_id === "string" && UUID_RE.test(c.subject_id)))) fail(`candidates.${i}.subject_id`);
      if (typeof c.label !== "string") fail(`candidates.${i}.label`);
      if (!optionalString(c.reason)) fail(`candidates.${i}.reason`);
      if (!(c.requirement_id === undefined || c.requirement_id === null || (typeof c.requirement_id === "string" && UUID_RE.test(c.requirement_id)))) {
        fail(`candidates.${i}.requirement_id`);
      }
    });
  }
  if (!(value.proposed_candidate === null || isInt(value.proposed_candidate, 0))) fail("proposed_candidate");

  if (!Array.isArray(value.segments)) {
    fail("segments");
  } else {
    value.segments.forEach((s, i) => {
      if (!isObject(s)) return fail(`segments.${i}`);
      if (!Array.isArray(s.pages) || s.pages.length === 0 || !s.pages.every((p) => isInt(p, 1))) fail(`segments.${i}.pages`);
      if (!nullableString(s.catalog_code)) fail(`segments.${i}.catalog_code`);
      if (!nullableString(s.title, LIMITS.segment_title)) fail(`segments.${i}.title`);
    });
  }
  if (!(value.page_count === null || isInt(value.page_count, 0))) fail("page_count");

  if (!isObject(value.reader)) {
    fail("reader");
  } else {
    for (const key of ["provider", "model", "prompt_hash", "response_hash"] as const) {
      if (!optionalString(value.reader[key])) fail(`reader.${key}`);
    }
    if (!(value.reader.subject_hints === undefined || isObject(value.reader.subject_hints))) fail("reader.subject_hints");
  }

  if (!isObject(value.jev)) {
    fail("jev");
  } else {
    if (!optionalString(value.jev.model)) fail("jev.model");
    if (!optionalString(value.jev.questions_version)) fail("jev.questions_version");
    const answers = value.jev.answers;
    if (answers !== undefined) {
      if (!isObject(answers)) {
        fail("jev.answers");
      } else {
        for (const [key, a] of Object.entries(answers)) {
          if (!isObject(a)) {
            fail(`jev.answers.${key}`);
            continue;
          }
          if (!oneOf(JEV_ANSWER_TYPES, a.type)) fail(`jev.answers.${key}.type`);
          if (!optionalString(a.choice)) fail(`jev.answers.${key}.choice`);
          for (const n of ["noul", "score", "confidence"] as const) {
            if (!optionalNumber(a[n])) fail(`jev.answers.${key}.${n}`);
          }
          if (a.probabilities !== undefined) {
            if (!isObject(a.probabilities) || !Object.values(a.probabilities).every((p) => typeof p === "number")) {
              fail(`jev.answers.${key}.probabilities`);
            }
          }
        }
      }
    }
  }

  if (!Array.isArray(value.checks)) {
    fail("checks");
  } else {
    value.checks.forEach((c, i) => {
      if (!isObject(c)) return fail(`checks.${i}`);
      if (typeof c.code !== "string") fail(`checks.${i}.code`);
      if (typeof c.label !== "string") fail(`checks.${i}.label`);
      if (!oneOf(CHECK_RESULTS, c.result)) fail(`checks.${i}.result`);
      if (!optionalString(c.detail)) fail(`checks.${i}.detail`);
      if (!oneOf(CHECK_SOURCES, c.source)) fail(`checks.${i}.source`);
    });
  }

  if (!Array.isArray(value.warnings)) {
    fail("warnings");
  } else {
    value.warnings.forEach((w, i) => {
      if (!isObject(w) || typeof w.code !== "string" || typeof w.message !== "string") fail(`warnings.${i}`);
    });
  }

  if (!isObject(value.stage_status)) {
    fail("stage_status");
  } else {
    for (const stage of ["reader", "jev"] as const) {
      const s = value.stage_status[stage];
      if (!isObject(s) || !oneOf(STAGE_STATES, s.state) || !optionalString(s.reason)) fail(`stage_status.${stage}`);
    }
  }
  return problems;
}
