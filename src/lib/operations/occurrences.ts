import { z } from "zod";

import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { REQUIREMENT_FACILITY_ROLES, REQUIREMENT_VIEW_ROLES } from "@/lib/operations/requirements";

/**
 * COL-139 subject-scoped occurrences. The database owns identity, authority,
 * idempotency and every lifecycle rule; these helpers only shape requests and
 * map database outcomes to bounded HTTP responses without echoing internals.
 */

export const OCCURRENCE_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
export const OCCURRENCE_COMMAND_ROLES = OPERATIONS_VIEW_ROLES;
export const BINDING_VIEW_ROLES = REQUIREMENT_VIEW_ROLES;
export const BINDING_COMMAND_ROLES = REQUIREMENT_FACILITY_ROLES;

export const OCCURRENCE_KINDS = ["scheduled", "event", "manual"] as const;
export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];
export const ASSOCIATION_KINDS = ["early", "late", "unscheduled"] as const;
export const BINDING_AUTHORITY_CLASSES = ["facility", "financial", "resident", "employee_personnel", "employee_medical", "asset"] as const;
export const BINDING_PROVENANCE_SOURCES = ["admin_log", "interview", "facility_policy", "regulator", "other"] as const;

const uuid = z.string().uuid();
const shift = z.enum(["day", "evening", "night"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a calendar date");
const instant = z.string().datetime({ offset: true });
const reason = z.string().trim().min(1).max(2000);
/** Client-minted idempotency key; the database stores it and detects replays. */
export const requestKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "request_key must be 8 to 128 key characters");

export const enrollBindingBodySchema = z
  .object({
    activity_id: uuid,
    facility_id: uuid,
    subject_id: uuid,
    authority_class: z.enum(BINDING_AUTHORITY_CLASSES),
    shift: shift.nullable().optional(),
    provenance: z.object({ source: z.enum(BINDING_PROVENANCE_SOURCES), reason }).strict(),
    effective_from: instant,
  })
  .strict();

export const retireBindingBodySchema = z.object({ effective_to: instant, reason }).strict();

export const manualOccurrenceBodySchema = z
  .object({
    activity_id: uuid,
    facility_id: uuid,
    subject_id: uuid,
    request_key: requestKeySchema,
    payload: z
      .object({
        queue_date: dateOnly.optional(),
        shift: shift.nullable().optional(),
        note: z.string().trim().max(2000).optional(),
      })
      .strict(),
  })
  .strict();

export const associateOccurrenceBodySchema = z
  .object({
    work_task_id: uuid,
    association_kind: z.enum(ASSOCIATION_KINDS),
    expected_revision: z.string().regex(/^[0-9a-f]{64}$/, "expected_revision must be the occurrence revision"),
    reason,
    request_key: requestKeySchema,
  })
  .strict();

export const cancelOccurrenceBodySchema = z.object({ reason, request_key: requestKeySchema }).strict();

export type EnrollBindingBody = z.infer<typeof enrollBindingBodySchema>;
export type ManualOccurrenceBody = z.infer<typeof manualOccurrenceBodySchema>;
export type AssociateOccurrenceBody = z.infer<typeof associateOccurrenceBodySchema>;

/** Columns a managed occurrence exposes to operator surfaces. */
export const OCCURRENCE_SELECT =
  "id, organization_id, facility_id, activity_id, subject_id, authority_class, template_name, template_category, assigned_shift_date, assigned_shift, assigned_to, assigned_role, status, due_at, occurrence_kind, binding_id, period_key, period_start_date, period_end_date, governing_at, grace_ends_at, remind_at, schedule_snapshot, source_event_key, source_event_id, source_event_at, request_key, requirement_version_id, facility_requirement_id, cancellation_reason, occurrence_revision, created_at, updated_at";

export const BINDING_SELECT =
  "id, organization_id, facility_id, activity_id, subject_id, authority_class, shift, provenance, effective_from, effective_to, retired_by, retired_at, retirement_reason, created_by, created_at";

/** Database messages that are safe and useful to show the operator verbatim. */
const TRUSTED_FRAGMENTS = [
  "already saved with different content",
  "changed since it was read",
  "already associated",
  "already cancelled",
  "is cancelled",
  "has recorded work",
  "has an open issue",
  "cannot be deferred",
  "cannot be reinstated",
  "cannot be cancelled",
  "cannot rewrite history",
  "need no binding",
  "must match the activity subject",
  "subject is not current",
  "binding already",
  "already retired",
  "must follow the binding start",
  "classification is required",
  "not in force",
  "is in force",
  "not applicable",
  "not editable",
  "payload must be an object",
  "contains an invalid",
  "requires a",
  "must be",
  "same activity",
  "same site",
  "same subject",
  "managed occurrence",
  "Managed occurrence",
];
/** Rejections of the request itself (shape or value), not of the current state. */
const CLIENT_ERROR_FRAGMENTS = ["contains an invalid", "not editable", "payload must be an object", "must be"];

export type OccurrenceRpcError = { code?: string; message?: string } | null | undefined;

/**
 * Authority denials hide existence; idempotency, state and validation
 * outcomes are reported with a bounded message; anything else is generic.
 */
export function mapOccurrenceRpcError(error: NonNullable<OccurrenceRpcError>): { status: number; error: string } {
  const message = error.message ?? "";
  if (error.code === "42501") return { status: 403, error: "Operation unavailable" };
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  if (error.code === "22023") return { status: 400, error: trusted ? message : "Occurrence request contains an invalid value" };
  if (error.code === "23505") return { status: 409, error: trusted ? message : "Occurrence request conflicts with an existing record" };
  if (error.code === "23514" || error.code === "P0001") {
    if (trusted && CLIENT_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, error: message };
    return { status: 409, error: trusted ? message : "Occurrence request could not be completed. Refresh and retry." };
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
    return { status: 400, error: "Occurrence request contains an invalid reference or value" };
  }
  return { status: 500, error: "Occurrence request could not be completed" };
}

export function isOccurrenceRecord(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export function isBindingRecord(value: unknown): value is Record<string, unknown> & { id: string; effective_from: string } {
  return isOccurrenceRecord(value) && typeof (value as { effective_from?: unknown }).effective_from === "string";
}

/** Association and cancellation commands return a receipt naming the target. */
export function isCommandReceipt(value: unknown): value is Record<string, unknown> & { replayed: boolean } {
  return !!value && typeof value === "object" && typeof (value as { replayed?: unknown }).replayed === "boolean";
}
