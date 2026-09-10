import { NextResponse } from "next/server";
import { z } from "zod";

import { actorCanAccessFacility, type OperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { requestKeySchema } from "@/lib/operations/occurrences";
import {
  correctWorkBodySchema,
  isIssueOutcome,
  isReceiptOutcome,
  mapReceiptRpcError,
  recordWorkPayloadSchema,
  reportIssueBodySchema,
  reverseWorkBodySchema,
  verifyWorkBodySchema,
  withoutRequestHash,
  type OutcomeClass,
  type ReceiptCommand,
} from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

/**
 * COL-146 recovery of interrupted saves (HFO-17). A draft is the exact
 * arguments of one command, stored server-side under the actor's own
 * identity with the request key the command will use, so a save whose answer
 * was lost can be reconciled against the database (the record exists under
 * that key or it does not) and, when unsaved, resumed without re-sending
 * edited content. The browser holds at most the draft id in memory. These
 * helpers shape requests, present drafts without server-side fingerprints
 * and map database outcomes to the bounded server-authoritative classes.
 */

export const DRAFT_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
export const DRAFT_COMMAND_ROLES = OPERATIONS_VIEW_ROLES;

export const DRAFT_COMMANDS = ["record_work", "verify_work", "correct_work", "reverse_work", "report_issue"] as const;
export type DraftCommand = (typeof DRAFT_COMMANDS)[number];
export const RECEIPT_DRAFT_COMMANDS = ["record_work", "verify_work", "correct_work", "reverse_work"] as const;
export const DRAFT_STATES = ["pending", "reconciled", "discarded", "expired"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];
/** Reconciliation answers: the truth lives in the database. */
export const DRAFT_OUTCOMES = ["saved", "unsaved", "expired", "discarded"] as const;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];
export const DRAFT_LIST_LIMIT = 50;
/** The database refuses larger arguments; the route refuses them first. */
export const DRAFT_ARGUMENTS_MAX_BYTES = 64 * 1024;

export const DRAFT_RPC = {
  save: "save_operation_command_draft_review",
  reconcile: "reconcile_operation_command_draft_review",
  resume: "resume_operation_command_draft_review",
  discard: "discard_operation_command_draft_review",
} as const;
export type DraftRouteCommand = keyof typeof DRAFT_RPC;

const uuid = z.string().uuid();

const receiptArguments = <T extends z.ZodTypeAny>(payload: T) => z.object({ payload }).strict();

/**
 * The arguments of each command exactly as its own route would send them:
 * the route body minus the request key, validated by the route's own
 * schema (COL-142 record, COL-145 verify/correct/reverse, COL-142 issue),
 * so the parsed, trimmed output stored in the draft hashes the same as the
 * command the route issues.
 */
export const DRAFT_ARGUMENTS_SCHEMAS = {
  record_work: receiptArguments(recordWorkPayloadSchema),
  verify_work: receiptArguments(verifyWorkBodySchema.shape.payload),
  correct_work: correctWorkBodySchema.omit({ request_key: true }),
  reverse_work: reverseWorkBodySchema.omit({ request_key: true }),
  report_issue: receiptArguments(reportIssueBodySchema.shape.payload),
} as const;

const receiptDraft = <C extends (typeof RECEIPT_DRAFT_COMMANDS)[number]>(command: C) =>
  z.object({ request_key: requestKeySchema, command: z.literal(command), target_id: uuid, arguments: DRAFT_ARGUMENTS_SCHEMAS[command] }).strict();

const issueDraft = z
  .object({ request_key: requestKeySchema, command: z.literal("report_issue"), target_id: uuid.optional(), facility_id: uuid.optional(), arguments: DRAFT_ARGUMENTS_SCHEMAS.report_issue })
  .strict()
  .superRefine((body, ctx) => {
    const payload = body.arguments.payload;
    if (body.target_id && body.target_id !== payload.task_instance_id) ctx.addIssue({ code: "custom", message: "target_id must name the occurrence of the issue report" });
    if (body.facility_id && body.facility_id !== payload.facility_id) ctx.addIssue({ code: "custom", message: "facility_id must name the site of the issue report" });
  });

export const saveDraftBodySchema = z
  .discriminatedUnion("command", [receiptDraft("record_work"), receiptDraft("verify_work"), receiptDraft("correct_work"), receiptDraft("reverse_work"), issueDraft])
  .superRefine((body, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(body.arguments)).byteLength > DRAFT_ARGUMENTS_MAX_BYTES) {
      ctx.addIssue({ code: "custom", message: "arguments must be at most 64 KiB" });
    }
  });

export type SaveDraftBody = z.infer<typeof saveDraftBodySchema>;

/** The first payload problem in words the operator can act on. */
export function draftPayloadProblem(error: z.ZodError): string | null {
  const custom = error.issues.find((candidate) => candidate.code === "custom");
  if (custom) return custom.message;
  const first = error.issues[0];
  if (!first) return null;
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** The list omits arguments (the RPC replies carry them to the owner) and nothing ever carries the hash. */
export const DRAFT_LIST_SELECT =
  "id, organization_id, facility_id, actor_id, command, target_id, request_key, state, created_at, updated_at, expires_at, reconciled_at, reconciled_record, discarded_at, revision";

export type DraftRow = Record<string, unknown> & { id: string; state?: string; expires_at?: string | null };

/**
 * A pending draft past its expiry reads as expired even before the database
 * marks it on touch; the fingerprint and the session are server-side
 * material and never leave the server.
 */
export function presentDraft<T extends DraftRow>(draft: T, now: number = Date.now()): Omit<T, "arguments_hash" | "actor_session_id"> {
  const { arguments_hash: _hash, actor_session_id: _session, ...rest } = draft as T & { arguments_hash?: unknown; actor_session_id?: unknown };
  void _hash;
  void _session;
  const expiresAt = typeof rest.expires_at === "string" ? Date.parse(rest.expires_at) : Number.NaN;
  if (rest.state === "pending" && Number.isFinite(expiresAt) && expiresAt <= now) return { ...rest, state: "expired" };
  return rest;
}

/** Database messages that are safe and useful to show the operator verbatim. */
const VALIDATION_FRAGMENTS = ["is required", "must be", "at most", "is invalid", "Command", "Target", "Facility", "Arguments"];
const CONFLICT_FRAGMENTS = ["already saved with different content", "Draft is not pending", "Draft cannot"];
const EXPIRED_WORDING = "Draft has expired";
const DISCARDED_WORDING = "Draft was discarded";
const NOT_PENDING_WORDING = "Draft is not pending";
const DRAFT_REFUSAL_FRAGMENTS = [EXPIRED_WORDING, DISCARDED_WORDING, NOT_PENDING_WORDING];
const TRUSTED_FRAGMENTS = [...VALIDATION_FRAGMENTS, ...CONFLICT_FRAGMENTS, EXPIRED_WORDING, DISCARDED_WORDING];

export type DraftRpcError = { code?: string; message?: string; details?: string | null } | null | undefined;
export type MappedDraftError = { status: number; outcome: OutcomeClass | "expired" | "discarded"; error: string };

const COMMAND_NOUN: Record<DraftRouteCommand, string> = { save: "Draft", reconcile: "Reconciliation", resume: "Resume", discard: "Discard" };

/**
 * Bounded classes: validation (400), denied (403 on save: another actor's
 * key, nothing disclosed), missing (404: a draft the caller does not own
 * reads as absent), conflict (409: changed replay), expired / discarded (409
 * with the outcome so the client lands in the matching state), uncertain
 * (500; the client reconciles before anything else).
 */
export function mapDraftRpcError(error: NonNullable<DraftRpcError>, command: DraftRouteCommand): MappedDraftError {
  const message = error.message ?? "";
  const noun = COMMAND_NOUN[command];
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  if (message.includes(EXPIRED_WORDING)) return { status: 409, outcome: "expired", error: EXPIRED_WORDING };
  if (message.includes(DISCARDED_WORDING)) return { status: 409, outcome: "discarded", error: DISCARDED_WORDING };
  if (error.code === "42501") {
    return command === "save" ? { status: 403, outcome: "denied", error: "Operation unavailable" } : { status: 404, outcome: "missing", error: "Draft not found" };
  }
  if (error.code === "P0002") return { status: 404, outcome: "missing", error: "Draft not found" };
  if (error.code === "22023") return { status: 400, outcome: "validation", error: trusted ? message : `${noun} request contains an invalid value` };
  if (error.code === "23505") return { status: 409, outcome: "conflict", error: trusted ? message : `${noun} request conflicts with an existing draft` };
  if (error.code === "23514" || error.code === "P0001") {
    if (CONFLICT_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 409, outcome: "conflict", error: message };
    if (trusted && VALIDATION_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, outcome: "validation", error: message };
    return { status: 409, outcome: "conflict", error: trusted ? message : `${noun} request could not be completed. Check the draft and retry.` };
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
    return { status: 400, outcome: "validation", error: `${noun} request contains an invalid reference or value` };
  }
  return { status: 500, outcome: "uncertain", error: `${noun} could not be confirmed; check the draft before retrying` };
}

const RESUME_RECEIPT_COMMAND: Record<DraftCommand, ReceiptCommand> = {
  record_work: "record",
  verify_work: "verify",
  correct_work: "correct",
  reverse_work: "reverse",
  report_issue: "issue",
};

export type MappedResumeError = MappedDraftError & { current_receipt_id?: string; current_receipt_revision?: string };

/**
 * On resume the underlying command's own exception propagates unchanged, so
 * it is mapped exactly as the original route would map it, with the
 * command's own noun and the current receipt and revision when the
 * database names them.
 */
export function mapResumeRpcError(error: NonNullable<DraftRpcError>, command: DraftCommand): MappedResumeError {
  const message = error.message ?? "";
  // Draft-level refusals (expired, discarded, not pending because another session resumed first) are draft outcomes, never receipt errors.
  if (DRAFT_REFUSAL_FRAGMENTS.some((fragment) => message.includes(fragment)) || error.code === "P0002") return mapDraftRpcError(error, "resume");
  return mapReceiptRpcError(error, RESUME_RECEIPT_COMMAND[command]);
}

/** The current-receipt fields of a mapped resume error, ready to spread into a response body. */
export function resumeErrorFields(mapped: MappedResumeError): { current_receipt_id?: string; current_receipt_revision?: string } {
  return {
    ...(mapped.current_receipt_id ? { current_receipt_id: mapped.current_receipt_id } : {}),
    ...(mapped.current_receipt_revision ? { current_receipt_revision: mapped.current_receipt_revision } : {}),
  };
}

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export type SaveDraftOutcome = { draft: DraftRow; replayed: boolean };
export type ReconcileOutcome = { draft: DraftRow; outcome: DraftOutcome; record?: Record<string, unknown> | null };
export type ResumeOutcome = { draft: DraftRow; outcome: "saved"; reply: Record<string, unknown> };
export type DiscardOutcome = { draft: DraftRow };

export function isSaveDraftOutcome(value: unknown): value is SaveDraftOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { draft?: unknown; replayed?: unknown };
  return hasId(candidate.draft) && typeof candidate.replayed === "boolean";
}

export function isReconcileOutcome(value: unknown): value is ReconcileOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { draft?: unknown; outcome?: unknown; record?: unknown };
  if (!hasId(candidate.draft) || !(DRAFT_OUTCOMES as readonly string[]).includes(String(candidate.outcome))) return false;
  if (candidate.outcome === "saved") return hasId(candidate.record);
  return candidate.record === undefined || candidate.record === null;
}

export function isResumeOutcome(value: unknown): value is ResumeOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { draft?: unknown; outcome?: unknown; reply?: unknown };
  return hasId(candidate.draft) && candidate.outcome === "saved" && !!candidate.reply && typeof candidate.reply === "object";
}

export function isDiscardOutcome(value: unknown): value is DiscardOutcome {
  if (!value || typeof value !== "object") return false;
  const draft = (value as { draft?: unknown }).draft;
  return hasId(draft) && draft.state === "discarded";
}

/**
 * The resumed command's own reply, presented as its original route presents
 * it: the receipt commands return the receipt, the occurrence and any issue;
 * the issue report returns the issue. Fingerprints are stripped. Anything
 * else is not a record and is reported as uncertain.
 */
export function presentResumedReply(command: DraftCommand, reply: unknown): Record<string, unknown> | null {
  if (command === "report_issue") {
    return isIssueOutcome(reply) ? { outcome: "receipt", issue: withoutRequestHash(reply.issue), replayed: reply.replayed } : null;
  }
  if (!isReceiptOutcome(reply)) return null;
  return { outcome: "receipt", receipt: withoutRequestHash(reply.receipt), occurrence: reply.occurrence, issue: reply.issue ? withoutRequestHash(reply.issue) : null, replayed: reply.replayed };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DraftTarget = { id: string; organization_id: string; facility_id: string; actor_id: string; state: string; target_id: string | null; command: string };

/**
 * Session read of one draft: RLS hides other actors' drafts and drafts whose
 * site or subject authority is gone; the actor check and the current site
 * grant are confirmed again before anything is done with it. A draft that is
 * not the caller's own reads as absent.
 */
export async function readDraftTarget(actor: OperationsActor, id: string, scope: string): Promise<{ target: DraftTarget } | { response: NextResponse }> {
  if (!UUID.test(id)) return { response: NextResponse.json({ error: "Draft not found", outcome: "missing" }, { status: 404 }) };
  const { data: row, error: readError } = await actor.currentActor.client
    .from("operation_command_drafts" as never)
    .select("id, organization_id, facility_id, actor_id, state, target_id, command")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError(scope, readError, { action: "read", draftId: id });
    return { response: NextResponse.json({ error: "Draft unavailable", outcome: "uncertain" }, { status: 503 }) };
  }
  const target = row as DraftTarget | null;
  if (!target || target.organization_id !== actor.organizationId || target.actor_id !== actor.id || !(await actorCanAccessFacility(actor, target.facility_id))) {
    return { response: NextResponse.json({ error: "Draft not found", outcome: "missing" }, { status: 404 }) };
  }
  return { target };
}
