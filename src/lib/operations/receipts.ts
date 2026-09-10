import { z } from "zod";

import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { requestKeySchema } from "@/lib/operations/occurrences";

/**
 * COL-142 execution receipts. The database owns recorder identity, server
 * time, authority, idempotency, evidence evaluation and every state rule;
 * these helpers only shape requests and map database outcomes to the bounded
 * server-authoritative classes (BUILD-SCOPE section 5) without echoing
 * internals. A saved receipt is the only evidence of acceptance.
 */

export const RECEIPT_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
export const RECEIPT_COMMAND_ROLES = OPERATIONS_VIEW_ROLES;

export const PERFORMER_KINDS = ["self", "other_staff", "vendor", "unknown_historical"] as const;
export const ENTRY_KINDS = ["routine", "late", "on_behalf"] as const;
export const WORK_OUTCOMES = ["performed", "failed", "not_performed"] as const;
export const ISSUE_KINDS = ["problem", "help_request", "failed_result"] as const;
export const ISSUE_SEVERITIES = ["low", "normal", "high"] as const;
export const COMPLETION_STATES = ["completed", "performed_missing_evidence", "awaiting_verification", "failed", "not_performed"] as const;
/** Server-authoritative outcome classes the UI must distinguish. */
export const OUTCOME_CLASSES = ["receipt", "validation", "denied", "missing", "conflict", "uncertain"] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

/** A stale client clock gets a plain refusal here; the database enforces the same bound. */
export const PERFORMED_AT_SKEW_MS = 2 * 60 * 1000;

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const primitive = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
/** Typed input values are flat: one primitive per input key; nested objects are never recorded values. */
const valuesSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "input keys are identifiers"), primitive);

const performerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("other_staff"), user_id: uuid }).strict(),
  z.object({ kind: z.literal("vendor"), vendor_id: uuid, label: text(200).optional() }).strict(),
  z.object({ kind: z.literal("unknown_historical"), label: text(200) }).strict(),
]);

const issueSchema = z.object({ kind: z.enum(ISSUE_KINDS), summary: text(2000), severity: z.enum(ISSUE_SEVERITIES).optional() }).strict();

export const recordWorkPayloadSchema = z
  .object({
    performed_at: instant.optional(),
    performer: performerSchema.optional(),
    entry_kind: z.enum(ENTRY_KINDS).optional(),
    entry_reason: text(2000).optional(),
    outcome: z.enum(WORK_OUTCOMES),
    values: valuesSchema.optional(),
    note: z.string().trim().max(4000).optional(),
    issue: issueSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.performed_at && new Date(payload.performed_at).getTime() > Date.now() + PERFORMED_AT_SKEW_MS) {
      ctx.addIssue({ code: "custom", message: "Performed time cannot be in the future" });
    }
    const entryKind = payload.entry_kind ?? "routine";
    if (entryKind !== "routine" && !payload.entry_reason) ctx.addIssue({ code: "custom", message: "entry_reason is required for a late or on-behalf entry" });
    if (payload.performer && payload.performer.kind !== "self" && entryKind === "routine") {
      ctx.addIssue({ code: "custom", message: "recording for another performer requires entry_kind on_behalf or late" });
    }
    if (payload.performer?.kind === "unknown_historical" && entryKind !== "late") {
      ctx.addIssue({ code: "custom", message: "an unknown historical performer requires a late entry" });
    }
    if (payload.outcome === "failed" && !payload.issue) ctx.addIssue({ code: "custom", message: "a failed outcome requires an issue" });
    if (payload.outcome === "not_performed" && !payload.entry_reason) ctx.addIssue({ code: "custom", message: "not_performed requires entry_reason" });
  });

export const recordWorkBodySchema = z.object({ request_key: requestKeySchema, payload: recordWorkPayloadSchema }).strict();

export const verifyWorkBodySchema = z
  .object({ request_key: requestKeySchema, payload: z.object({ decision: z.literal("verified"), note: z.string().trim().max(4000).optional() }).strict() })
  .strict();

export const reportIssueBodySchema = z
  .object({
    request_key: requestKeySchema,
    payload: z
      .object({
        task_instance_id: uuid.optional(),
        activity_id: uuid.optional(),
        facility_id: uuid.optional(),
        subject_id: uuid.optional(),
        kind: z.enum(ISSUE_KINDS),
        summary: text(2000),
        severity: z.enum(ISSUE_SEVERITIES).optional(),
      })
      .strict()
      .superRefine((payload, ctx) => {
        const scoped = Boolean(payload.activity_id && payload.facility_id && payload.subject_id);
        if (payload.task_instance_id ? Boolean(payload.activity_id || payload.facility_id || payload.subject_id) : !scoped) {
          ctx.addIssue({ code: "custom", message: "name either the occurrence or the activity, site and subject" });
        }
      }),
  })
  .strict();

export type RecordWorkBody = z.infer<typeof recordWorkBodySchema>;
export type VerifyWorkBody = z.infer<typeof verifyWorkBodySchema>;
export type ReportIssueBody = z.infer<typeof reportIssueBodySchema>;

/** The first payload problem in words the operator can act on. */
export function payloadProblem(error: z.ZodError): string | null {
  const custom = error.issues.find((candidate) => candidate.code === "custom");
  if (custom) return custom.message;
  const first = error.issues[0];
  if (!first) return null;
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

export const RECEIPT_SELECT =
  "id, organization_id, facility_id, task_instance_id, activity_id, subject_id, authority_class, requirement_version_id, facility_requirement_id, receipt_kind, recorder_id, recorder_role, recorded_at, performed_at, performer_kind, performer_user_id, performer_vendor_id, performer_label, entry_kind, entry_reason, outcome, values, note, evidence_status, missing_evidence, completion_state, issue_id, request_key, revision, superseded_by_receipt_id, created_at";

/** Database messages that are safe and useful to show the operator verbatim. */
const TRUSTED_FRAGMENTS = [
  "Recorded values",
  "Performed time",
  "Performer",
  "requires",
  "are required",
  "carries no identifier",
  "must be entered as late",
  "Manual occurrence",
  "Association",
  "Verification",
  "Required evidence is missing",
  "A different authorized staff member must verify this task",
  "Work is already recorded",
  "already recorded",
  "already saved with different content",
  "changed since",
  "cannot be recorded",
  "cannot be verified",
  "is cancelled",
  "is required",
  "must be",
  "not editable",
  "is invalid",
  "not awaiting verification",
  "Legacy",
  "Managed occurrence",
];
const CONFLICT_FRAGMENTS = [
  "Required evidence is missing",
  "A different authorized staff member must verify this task",
  "already recorded",
  "Work is already recorded",
  "already saved with different content",
  "changed since",
  "cannot be recorded",
  "cannot be verified",
  "is cancelled",
  "not awaiting verification",
];
const VALIDATION_FRAGMENTS = ["is required", "are required", "requires", "must be", "not editable", "is invalid", "carries no identifier", "Recorded values", "Performed time", "Performer"];
const INDEPENDENCE_WORDING = "A different authorized staff member must verify this task";

export type ReceiptRpcError = { code?: string; message?: string; details?: string | null } | null | undefined;
export type MappedReceiptError = { status: number; outcome: OutcomeClass; error: string; current_receipt_id?: string };

const UUID_IN_DETAILS = /current_receipt_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Bounded outcome classes: validation (400), denied (403, hides existence),
 * missing (404), conflict (409, names the current receipt when the database
 * does), uncertain (500; the client must check the occurrence, never retry
 * blindly). Untrusted wording is never echoed.
 */
export type ReceiptCommand = "record" | "verify" | "issue";
const COMMAND_NOUN: Record<ReceiptCommand, { request: string; conflict: string; confirm: string }> = {
  record: { request: "Record request", conflict: "an existing receipt", confirm: "Record" },
  verify: { request: "Verification request", conflict: "an existing verification", confirm: "Verification" },
  issue: { request: "Issue report", conflict: "an existing issue", confirm: "Issue report" },
};

export function mapReceiptRpcError(error: NonNullable<ReceiptRpcError>, command: ReceiptCommand = "record"): MappedReceiptError {
  const message = error.message ?? "";
  const noun = COMMAND_NOUN[command];
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  const currentReceipt = UUID_IN_DETAILS.exec(`${error.details ?? ""} ${message}`)?.[1];
  const withReceipt = (mapped: MappedReceiptError): MappedReceiptError => (currentReceipt ? { ...mapped, current_receipt_id: currentReceipt } : mapped);
  // Independence is a state conflict the reviewer can act on, not a hidden denial, even though the database raises it as 42501.
  if (message.includes(INDEPENDENCE_WORDING)) return { status: 409, outcome: "conflict", error: INDEPENDENCE_WORDING };
  if (error.code === "42501") return { status: 403, outcome: "denied", error: "Operation unavailable" };
  if (error.code === "P0002") return { status: 404, outcome: "missing", error: "Occurrence not found" };
  if (error.code === "22023") return { status: 400, outcome: "validation", error: trusted ? message : `${noun.request} contains an invalid value` };
  if (error.code === "23505") {
    return withReceipt({ status: 409, outcome: "conflict", error: trusted ? message : `${noun.request} conflicts with ${noun.conflict}` });
  }
  if (error.code === "23514" || error.code === "P0001") {
    if (CONFLICT_FRAGMENTS.some((fragment) => message.includes(fragment))) return withReceipt({ status: 409, outcome: "conflict", error: message });
    if (trusted && VALIDATION_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, outcome: "validation", error: message };
    return withReceipt({ status: 409, outcome: "conflict", error: trusted ? message : `${noun.request} could not be completed. Refresh the occurrence and retry.` });
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
    return { status: 400, outcome: "validation", error: `${noun.request} contains an invalid reference or value` };
  }
  return { status: 500, outcome: "uncertain", error: `${noun.confirm} could not be confirmed; check the occurrence before retrying` };
}

/** Request fingerprints are server-side idempotency material, not operator data. */
export function withoutRequestHash<T extends Record<string, unknown>>(record: T): Omit<T, "request_hash"> {
  const { request_hash: _requestHash, ...rest } = record;
  void _requestHash;
  return rest;
}

export type ReceiptOutcome = {
  receipt: Record<string, unknown> & { id: string };
  occurrence: Record<string, unknown> & { id: string };
  issue: (Record<string, unknown> & { id: string }) | null;
  replayed: boolean;
};

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/** The record and verify commands return the receipt, the occurrence state and any issue created with it. */
export function isReceiptOutcome(value: unknown): value is ReceiptOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { receipt?: unknown; occurrence?: unknown; issue?: unknown; replayed?: unknown };
  return hasId(candidate.receipt) && hasId(candidate.occurrence) && typeof candidate.replayed === "boolean" && (candidate.issue === null || candidate.issue === undefined || hasId(candidate.issue));
}

export function isIssueOutcome(value: unknown): value is { issue: Record<string, unknown> & { id: string }; replayed: boolean } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { issue?: unknown; replayed?: unknown };
  return hasId(candidate.issue) && typeof candidate.replayed === "boolean";
}
