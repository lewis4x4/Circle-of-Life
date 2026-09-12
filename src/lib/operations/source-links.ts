import { z } from "zod";

import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { requestKeySchema } from "@/lib/operations/occurrences";

/**
 * COL-147 source links. A final domain record satisfies exactly the
 * occurrence it was meant for, once, through an allowlisted adapter whose
 * reader the database consults live at delivery time. These helpers only
 * shape requests and read replies; the database owns the allowlist, the
 * matching predicate, replay convergence, correction and invalidation, and
 * every refusal reason. Nothing here decides that any source is final.
 */

export const SOURCE_EVENT_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
/** Session delivery is available to every operations recorder; the database applies the recorder list to the source author. */
export const SOURCE_EVENT_DELIVER_ROLES = OPERATIONS_VIEW_ROLES;
/** Reconciliation is the COL-133 broad operations scope the database enforces again. */
export const SOURCE_EVENT_RECONCILE_ROLES = ["owner", "org_admin", "facility_admin", "manager", "admin_assistant", "coordinator"] as const;

export const SOURCE_EVENT_KINDS = ["final", "voided"] as const;
export const SOURCE_EVENT_STATES = ["satisfied", "corrected", "invalidated", "unmatched", "ambiguous", "conflict", "refused", "dismissed"] as const;
/** States that stay visible as pending reconciliation until a reconcile command resolves them. */
export const SOURCE_EVENT_PENDING_STATES = ["unmatched", "ambiguous", "conflict", "invalidated"] as const;
export const SOURCE_EVENT_REASONS = [
  "reader_missing",
  "reader_failed",
  "record_missing",
  "source_version_changed",
  "source_not_final",
  "source_voided",
  "source_not_voided",
  "facility_mismatch",
  "activity_not_allowlisted",
  "subject_kind_mismatch",
  "subject_not_enrolled",
  "recorder_unknown",
  "recorder_not_current",
  "recorder_not_authorized",
  "subject_not_current",
  "statement_invalid",
  "no_candidate",
  "several_candidates",
  "already_recorded",
  "nothing_to_invalidate",
  "source_not_effective",
  "occurrence_cancelled",
  "adapter_retired",
] as const;
export const SOURCE_RECONCILE_ACTIONS = ["retry", "select", "dismiss"] as const;

const uuid = z.string().uuid();
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "source_key must be a slug");
const recordId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "source_record_id must be a stable identifier");
const recordVersion = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, "source_record_version must be a stable identifier");
/** The event fingerprint the client read; the database refuses a stale one so a concurrent reconcile conflicts safely. */
export const eventRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/, "event revision must be 64 hex characters");

export const deliverSourceEventBodySchema = z
  .object({
    request_key: requestKeySchema,
    payload: z
      .object({ source_key: slug, source_record_id: recordId, source_record_version: recordVersion, event_kind: z.enum(SOURCE_EVENT_KINDS), facility_id: uuid })
      .strict(),
  })
  .strict();

export const reconcileSourceEventBodySchema = z
  .object({
    request_key: requestKeySchema,
    expected_revision: eventRevisionSchema,
    payload: z
      .object({ action: z.enum(SOURCE_RECONCILE_ACTIONS), occurrence_id: uuid.optional(), reason: z.string().trim().min(1).max(2000).optional() })
      .strict()
      .superRefine((payload, ctx) => {
        if (payload.action === "select" && !payload.occurrence_id) ctx.addIssue({ code: "custom", message: "select requires occurrence_id" });
        if (payload.action !== "select" && payload.occurrence_id) ctx.addIssue({ code: "custom", message: "occurrence_id applies to select only" });
        if (payload.action === "dismiss" && !payload.reason) ctx.addIssue({ code: "custom", message: "dismiss requires a reason" });
      }),
  })
  .strict();

export const listSourceEventsQuerySchema = z
  .object({
    facility_id: uuid,
    attention: z.enum(["true", "false"]).optional(),
    state: z.enum(SOURCE_EVENT_STATES).optional(),
  })
  .strict();

export type DeliverSourceEventBody = z.infer<typeof deliverSourceEventBodySchema>;
export type ReconcileSourceEventBody = z.infer<typeof reconcileSourceEventBodySchema>;
export type ListSourceEventsQuery = z.infer<typeof listSourceEventsQuerySchema>;

/** Ledger columns read through the session; the snapshot is included because RLS already limits who can read the row. */
export const SOURCE_EVENT_SELECT =
  "id, organization_id, facility_id, source_key, source_record_id, source_record_version, event_kind, delivery_kind, delivered_by, delivered_at, request_key, activity_id, subject_id, authority_class, task_instance_id, receipt_id, state, attention, reason, detail, candidates, snapshot, reconciled_by, reconciled_at, revision, created_at";

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export type SourceDeliveryOutcome = {
  event: Record<string, unknown> & { id: string; state: string; attention: boolean };
  occurrence: (Record<string, unknown> & { id: string }) | null;
  receipt: (Record<string, unknown> & { id: string }) | null;
  candidates: string[];
  replayed: boolean;
};

/** Delivery and reconcile return the ledger row, the occurrence and receipt it touched (if any), the candidate ids and whether this was a replay. */
export function isSourceDeliveryOutcome(value: unknown): value is SourceDeliveryOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { event?: unknown; occurrence?: unknown; receipt?: unknown; candidates?: unknown; replayed?: unknown };
  const event = candidate.event as { state?: unknown; attention?: unknown } | undefined;
  return (
    hasId(candidate.event) &&
    typeof event?.state === "string" &&
    typeof event?.attention === "boolean" &&
    (candidate.occurrence === null || candidate.occurrence === undefined || hasId(candidate.occurrence)) &&
    (candidate.receipt === null || candidate.receipt === undefined || hasId(candidate.receipt)) &&
    Array.isArray(candidate.candidates) &&
    candidate.candidates.every((id) => typeof id === "string") &&
    typeof candidate.replayed === "boolean"
  );
}

/** The current-event revision a reconcile conflict names, so the client can re-read and retry against it. */
const EVENT_REVISION_IN_DETAILS = /current_event_revision=([0-9a-f]{64})/i;

export function currentEventRevision(error: { details?: string | null; message?: string } | null | undefined): string | undefined {
  if (!error) return undefined;
  return EVENT_REVISION_IN_DETAILS.exec(`${error.details ?? ""} ${error.message ?? ""}`)?.[1];
}

/** A delivery reply as the route returns it: the server-owned rows without idempotency material. */
export function presentSourceOutcome(outcome: SourceDeliveryOutcome) {
  const { request_hash: _eventHash, ...event } = outcome.event as Record<string, unknown> & { id: string; state: string; attention: boolean; request_hash?: unknown };
  void _eventHash;
  let receipt: Record<string, unknown> | null = null;
  if (outcome.receipt) {
    const { request_hash: _receiptHash, ...rest } = outcome.receipt as Record<string, unknown> & { request_hash?: unknown };
    void _receiptHash;
    receipt = rest;
  }
  return { outcome: "receipt" as const, event, occurrence: outcome.occurrence ?? null, receipt, candidates: outcome.candidates, replayed: outcome.replayed };
}
