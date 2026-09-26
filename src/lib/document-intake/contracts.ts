/**
 * Document Intake: shared contract (COL-771, DI-01).
 *
 * The single TypeScript description of migration 545's tables and RPCs. The
 * review UI, the API routes and the tests import from here; the Edge Function
 * worker keeps a Deno copy of the proposal result shape in
 * `supabase/functions/_shared/document-intake-contract.ts`, and
 * `worker-contract.test.ts` keeps the two from drifting.
 *
 * Spec: docs/specs/41-document-intake.md.
 */
import { z } from "zod";

export const DOCUMENT_INTAKE_BUCKET = "document-intake";
/** Upper bound the bucket accepts; the organization setting may be lower. */
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

export const ITEM_STATUSES = [
  "receiving",
  "queued",
  "processing",
  "pending_review",
  "held",
  "needs_attention",
  "filed",
  "excluded",
  "duplicate",
  "split",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PROCESSING_STATES = [
  "not_started",
  "queued",
  "running",
  "succeeded",
  "blocked",
  "failed",
  "uncertain",
  "skipped",
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export const DESTINATION_KINDS = ["resident_document", "benefits_document", "employee_file", "facility_document"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const SUBJECT_KINDS = ["resident", "staff", "facility", "medicaid_case", "none"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** Workspace tabs → the item statuses each shows. */
export const INTAKE_TABS = {
  pending: { label: "Pending review", statuses: ["pending_review", "held"] },
  processing: { label: "Processing", statuses: ["receiving", "queued", "processing"] },
  attention: { label: "Needs attention", statuses: ["needs_attention"] },
  filed: { label: "Filed", statuses: ["filed"] },
  all: { label: "All", statuses: [...ITEM_STATUSES] },
} as const satisfies Record<string, { label: string; statuses: readonly ItemStatus[] }>;
export type IntakeTab = keyof typeof INTAKE_TABS;

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  receiving: "Receiving",
  queued: "Waiting to be read",
  processing: "Reading",
  pending_review: "Pending review",
  held: "On hold",
  needs_attention: "Needs attention",
  filed: "Filed",
  excluded: "Excluded",
  duplicate: "Duplicate",
  split: "Split into parts",
};

/** Honest stage wording: never a fake zero or a green check when a stage did not run. */
export const PROCESSING_STATE_LABELS: Record<ProcessingState, string> = {
  not_started: "Not read yet",
  queued: "Waiting to be read",
  running: "Reading now",
  succeeded: "Read",
  blocked: "AI not run",
  failed: "AI failed",
  uncertain: "AI result unknown",
  skipped: "AI not used for this type",
};

// ── Rows (as returned by RLS-scoped selects) ────────────────────────────────

export const catalogRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  description: z.string(),
  document_group: z.enum(["resident", "medicaid", "staff", "facility", "vendor", "other"]),
  destination_kind: z.enum([...DESTINATION_KINDS, "none"]),
  destination_category: z.string().nullable(),
  subject_kind: z.enum(SUBJECT_KINDS),
  contains_phi: z.boolean(),
  reviewer_roles: z.array(z.string()),
  reader_enabled: z.boolean(),
  jev_enabled: z.boolean(),
  reader_hint: z.string(),
  active: z.boolean(),
  sort_order: z.number().int(),
  revision: z.number().int(),
});
export type CatalogRow = z.infer<typeof catalogRowSchema>;

/** Item JSON returned by RPCs (storage_path and object_id are never returned). */
export const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  facility_id: z.string().uuid().nullable(),
  channel: z.enum(["upload", "email", "split"]),
  message_id: z.string().uuid().nullable(),
  parent_item_id: z.string().uuid().nullable(),
  parent_pages: z.array(z.number().int()).nullable(),
  original_filename: z.string(),
  display_title: z.string().nullable(),
  declared_mime: z.string(),
  declared_size_bytes: z.number().int(),
  declared_sha256: z.string(),
  verified_mime: z.string().nullable(),
  verified_sha256: z.string().nullable(),
  page_count: z.number().int().nullable(),
  status: z.enum(ITEM_STATUSES),
  processing_state: z.enum(PROCESSING_STATES),
  processing_reason: z.string().nullable(),
  attention_reason: z.string().nullable(),
  hold_reason: z.string().nullable(),
  exclude_reason: z.string().nullable(),
  duplicate_of: z.string().uuid().nullable(),
  assigned_to: z.string().uuid().nullable(),
  claimed_by: z.string().uuid().nullable(),
  claim_expires_at: z.string().nullable(),
  current_proposal_id: z.string().uuid().nullable(),
  revision: z.string().uuid(),
  sender_address: z.string().nullable(),
  sender_authenticated: z.boolean(),
  received_at: z.string(),
  created_by: z.string().uuid().nullable(),
  created_principal: z.enum(["person", "mail_receiver", "split"]),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
}).passthrough();
export type IntakeItem = z.infer<typeof itemSchema>;

/** One destination option the reader/Jev proposed, or the reviewer chose. */
export const candidateSchema = z.object({
  kind: z.enum([...DESTINATION_KINDS, "none"]),
  catalog_code: z.string(),
  subject_id: z.string().uuid().nullable(),
  /** What a reviewer sees: the name, plus the room for a resident. Scoped like the item. */
  label: z.string(),
  reason: z.string().optional(),
  requirement_id: z.string().uuid().nullable().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const stageStatusSchema = z.object({
  state: z.enum(["ran", "not_authorized", "not_configured", "failed", "not_applicable", "skipped"]),
  reason: z.string().optional(),
});
export type StageStatus = z.infer<typeof stageStatusSchema>;

/** Jev answer as stored: the probabilities are the provider's, never re-labelled as accuracy. */
export const jevAnswerSchema = z.object({
  type: z.enum(["noul", "choice", "score"]),
  choice: z.string().optional(),
  noul: z.number().optional(),
  score: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

export const proposalResultSchema = z.object({
  outcome: z.enum(["proposed", "blocked", "skipped"]),
  outcome_code: z.string().max(120).optional(),
  processing_reason: z.string().max(200).optional(),
  suggested_title: z.string().max(200).nullable(),
  summary: z.string().max(600).nullable(),
  summary_pages: z.array(z.number().int().positive()).default([]),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  catalog_code: z.string().nullable(),
  candidates: z.array(candidateSchema).default([]),
  proposed_candidate: z.number().int().nonnegative().nullable(),
  segments: z.array(z.object({
    pages: z.array(z.number().int().positive()).min(1),
    catalog_code: z.string().nullable(),
    title: z.string().max(200).nullable(),
  })).default([]),
  page_count: z.number().int().nonnegative().nullable(),
  reader: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    prompt_hash: z.string().optional(),
    response_hash: z.string().optional(),
    subject_hints: z.record(z.string(), z.unknown()).optional(),
  }).passthrough().default({}),
  jev: z.object({
    model: z.string().optional(),
    questions_version: z.string().optional(),
    answers: z.record(z.string(), jevAnswerSchema).optional(),
  }).passthrough().default({}),
  checks: z.array(z.object({
    code: z.string(),
    label: z.string(),
    result: z.enum(["pass", "fail", "unknown"]),
    detail: z.string().optional(),
    source: z.enum(["code", "jev", "reader"]),
  })).default([]),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  stage_status: z.object({ reader: stageStatusSchema, jev: stageStatusSchema }),
});
export type ProposalResult = z.infer<typeof proposalResultSchema>;

export const proposalRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  run_id: z.string().uuid(),
  generation: z.number().int(),
  suggested_title: z.string().nullable(),
  summary: z.string().nullable(),
  summary_pages: z.array(z.number().int()).nullable(),
  document_date: z.string().nullable(),
  catalog_code: z.string().nullable(),
  candidates: z.array(candidateSchema),
  proposed_candidate: z.number().int().nullable(),
  segments: proposalResultSchema.shape.segments,
  reader: z.record(z.string(), z.unknown()),
  jev: z.record(z.string(), z.unknown()),
  checks: proposalResultSchema.shape.checks,
  warnings: proposalResultSchema.shape.warnings,
  stage_status: z.object({ reader: stageStatusSchema.optional(), jev: stageStatusSchema.optional() }).passthrough(),
  created_at: z.string(),
}).passthrough();
export type ProposalRow = z.infer<typeof proposalRowSchema>;

export const filingRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  facility_id: z.string().uuid(),
  catalog_code: z.string(),
  destination_kind: z.enum(DESTINATION_KINDS),
  destination_category: z.string(),
  subject_id: z.string().uuid(),
  title: z.string(),
  destination_record_id: z.string().uuid().nullable(),
  state: z.enum(["preparing", "attested", "filed", "abandoned", "corrected"]),
  reviewer_changes: z.record(z.string(), z.unknown()),
  approved_by: z.string().uuid(),
  approved_at: z.string().nullable(),
  corrected_by: z.string().uuid().nullable(),
  corrected_at: z.string().nullable(),
  correction_reason: z.string().nullable(),
  created_at: z.string(),
}).passthrough();
export type FilingRow = z.infer<typeof filingRowSchema>;

export const eventRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  event: z.string(),
  actor_id: z.string().uuid().nullable(),
  principal: z.enum(["person", "mail_receiver", "worker", "system"]),
  detail: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type EventRow = z.infer<typeof eventRowSchema>;

// ── API request bodies (Next routes under /api/admin/document-intake) ──────

const requestKey = z.string().uuid();
const revision = z.string().uuid();

export const prepareUploadBodySchema = z.object({
  request_key: requestKey,
  facility_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255).refine((v) => !/[\\/]/.test(v), "Invalid file name"),
  declared_mime: z.enum(DOCUMENT_INTAKE_MIME_TYPES),
  declared_size_bytes: z.number().int().positive().max(DOCUMENT_INTAKE_MAX_SOURCE_BYTES),
  declared_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const finalizeUploadBodySchema = z.object({ request_key: requestKey });

export const COMMANDS = [
  "claim",
  "release",
  "assign",
  "hold",
  "resume",
  "exclude",
  "mark_duplicate",
  "set_facility",
  "set_title",
  "reprocess",
] as const;
export type IntakeCommand = (typeof COMMANDS)[number];

export const commandBodySchema = z.object({
  request_key: requestKey,
  expected_revision: revision,
  command: z.enum(COMMANDS),
  payload: z.object({
    reason: z.string().trim().max(2000).optional(),
    user_id: z.string().uuid().nullable().optional(),
    duplicate_of: z.string().uuid().optional(),
    facility_id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    accept_possible_duplicate_charge: z.boolean().optional(),
  }).strict().default({}),
});

export const splitBodySchema = z.object({
  request_key: requestKey,
  expected_revision: revision,
  parts: z.array(z.object({
    pages: z.array(z.number().int().positive()).min(1),
    title: z.string().trim().max(200).optional(),
  })).min(1).max(50),
  excluded_pages: z.array(z.number().int().positive()).default([]),
});

/** A reviewer's grade of one flagged Jev check at filing (migration 559). */
export const CHECK_VERDICTS = ["right", "wrong", "cant_tell"] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];
/** { "<check_code>": verdict }; the filing RPC refuses codes that are not the proposal's Jev checks. */
export const checkVerdictsSchema = z.record(z.string().min(1).max(120), z.enum(CHECK_VERDICTS));
export type CheckVerdicts = z.infer<typeof checkVerdictsSchema>;

export const fileBodySchema = z.object({
  request_key: requestKey,
  expected_revision: revision,
  catalog_code: z.string().min(1),
  subject_id: z.string().uuid().nullable(),
  requirement_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  check_verdicts: checkVerdictsSchema.optional(),
});

export const correctBodySchema = z.object({
  request_key: requestKey,
  reason: z.string().trim().min(1).max(2000),
});

/** Where a filed document opens from its record (the two-click check). */
export function destinationHref(kind: DestinationKind, filing: { subject_id: string; facility_id: string; destination_record_id: string | null }): string {
  switch (kind) {
    case "resident_document":
      return `/admin/residents/${filing.subject_id}/documents`;
    case "benefits_document":
      return `/admin/benefits/${filing.subject_id}`;
    case "employee_file":
      return `/admin/staff/${filing.subject_id}`;
    case "facility_document":
      return `/admin/facilities/${filing.facility_id}?tab=documents`;
  }
}

/** Postgres error code → HTTP status + outcome, shared by every intake route. */
export function mapIntakeRpcError(error: { code?: string; message?: string } | null | undefined): {
  status: number;
  outcome: "validation" | "forbidden" | "missing" | "conflict" | "state" | "retryable";
  error: string;
} {
  const message = error?.message && error.message.length <= 300 ? error.message : "Request failed";
  switch (error?.code) {
    case "22023":
    case "22P02":
    case "23514":
      return { status: 400, outcome: "validation", error: message };
    case "42501":
      return { status: 403, outcome: "forbidden", error: message };
    case "P0002":
      return { status: 404, outcome: "missing", error: "Document not found" };
    case "40001":
      return { status: 409, outcome: "conflict", error: message };
    case "55000":
      return { status: 409, outcome: "state", error: message };
    default:
      return { status: 503, outcome: "retryable", error: "Could not complete the request; retry with the same request key" };
  }
}
