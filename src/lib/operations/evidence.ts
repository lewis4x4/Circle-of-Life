import { NextResponse } from "next/server";
import { z } from "zod";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { requestKeySchema } from "@/lib/operations/occurrences";
import { withoutRequestHash, type OutcomeClass } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

/**
 * COL-143 scoped verified evidence (source-only portion). The database owns
 * the evidence identity, its state machine, the storage path, the receipt
 * revision check, idempotency and the satisfaction transition; these helpers
 * shape requests, run the shared route flow and map database outcomes to the
 * bounded server-authoritative classes without echoing internals. Bytes move
 * only through Storage under the session's own policies; no route ever
 * returns another uploader's object path.
 */

export const EVIDENCE_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
export const EVIDENCE_COMMAND_ROLES = OPERATIONS_VIEW_ROLES;

export const EVIDENCE_BUCKET = "operation-evidence";
export const OBJECT_EVIDENCE_KINDS = ["document", "photo", "signature"] as const;
export const EVIDENCE_KINDS = [...OBJECT_EVIDENCE_KINDS, "linked_record"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EVIDENCE_STATES = ["prepared", "uploaded", "finalized", "failed"] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export const EVIDENCE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const LINKED_RECORD_TABLES = ["facility_documents", "employee_file_records"] as const;
export const EVIDENCE_COMMANDS = ["prepare", "uploaded", "finalize", "fail"] as const;
export type EvidenceCommand = (typeof EVIDENCE_COMMANDS)[number];
/**
 * What a command did with the evidence, as the database reports it: the plain
 * transitions, or the checksum outcomes. A checksum mismatch or a changed
 * object is a durable failure (the row is `failed`), and an unverifiable
 * checksum leaves the row `uploaded` but unverified; none of them is an
 * exception, so the reply carries the row.
 */
export const EVIDENCE_RESULT_OUTCOMES = ["prepared", "uploaded", "finalized", "failed", "checksum_mismatch", "checksum_unverifiable", "object_changed"] as const;
export type EvidenceResultOutcome = (typeof EVIDENCE_RESULT_OUTCOMES)[number];
/** Signed download URLs are short-lived; the policy decides again on every request. */
export const DOWNLOAD_URL_SECONDS = 60;

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 hex characters");
/** The MD5 of the bytes about to be uploaded (see md5.ts); the database verifies it against the Storage eTag. */
const md5 = z.string().regex(/^[0-9a-f]{32}$/, "md5 must be 32 lowercase hex characters");
/** The evidence id owns the object path; the filename is the last segment and stays plain. */
export const filenameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/, "filename must be plain characters, at most 120 long");
/** The receipt fingerprint the client read; the database refuses a stale one so a concurrent correction conflicts safely. */
export const expectedReceiptRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected_receipt_revision must be the receipt revision");

const ruleLabel = text(200).optional();

const objectPayload = <K extends (typeof OBJECT_EVIDENCE_KINDS)[number]>(kind: K) =>
  z
    .object({
      kind: z.literal(kind),
      rule_label: ruleLabel,
      filename: filenameSchema,
      mime: z.enum(EVIDENCE_MIME_TYPES),
      size_bytes: z.number().int().min(1).max(EVIDENCE_MAX_BYTES),
      md5,
      sha256: sha256.optional(),
    })
    .strict();

export const preparePayloadSchema = z.discriminatedUnion("kind", [
  objectPayload("document"),
  objectPayload("photo"),
  objectPayload("signature"),
  z
    .object({
      kind: z.literal("linked_record"),
      rule_label: ruleLabel,
      linked_table: z.enum(LINKED_RECORD_TABLES),
      linked_record_id: uuid,
    })
    .strict(),
]);

export const prepareEvidenceBodySchema = z.object({ receipt_id: uuid, request_key: requestKeySchema, payload: preparePayloadSchema }).strict();
export const uploadedEvidenceBodySchema = z.object({ request_key: requestKeySchema }).strict();
export const finalizeEvidenceBodySchema = z
  .object({ request_key: requestKeySchema, expected_receipt_revision: expectedReceiptRevisionSchema, payload: z.object({ sha256: sha256.optional() }).strict().optional() })
  .strict();
export const failEvidenceBodySchema = z.object({ request_key: requestKeySchema, payload: z.object({ reason: text(2000) }).strict() }).strict();

export type PrepareEvidenceBody = z.infer<typeof prepareEvidenceBodySchema>;

export const EVIDENCE_COMMAND_RPC: Record<EvidenceCommand, string> = {
  prepare: "prepare_operation_evidence_review",
  uploaded: "mark_operation_evidence_uploaded_review",
  finalize: "finalize_operation_evidence_review",
  fail: "fail_operation_evidence_review",
};

const COMMAND_FALLBACK: Record<EvidenceCommand, string> = {
  prepare: "Provide a receipt, a request key and an evidence payload with a kind",
  uploaded: "Provide a request key",
  finalize: "Provide a request key and the receipt revision",
  fail: "Provide a request key and a reason",
};

/** The first payload problem in words the operator can act on. */
export function evidencePayloadProblem(error: z.ZodError): string | null {
  const custom = error.issues.find((candidate) => candidate.code === "custom");
  if (custom) return custom.message;
  const first = error.issues[0];
  if (!first) return null;
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * Columns read through the session. `object_path` is included so the
 * uploader can resume an in-flight upload; presentEvidence strips it from
 * every other row before it leaves the server.
 */
export const EVIDENCE_SELECT =
  "id, organization_id, facility_id, activity_id, subject_id, authority_class, receipt_id, task_instance_id, evidence_kind, rule_label, state, bucket_id, object_path, declared_mime, declared_size_bytes, declared_sha256, declared_md5, checksum_verified, checksum_method, checksum_verified_at, object_id, object_etag, object_version, object_size_bytes, object_mime, linked_table, linked_record_id, uploaded_by, prepared_at, uploaded_at, finalized_at, finalized_by, failed_at, failure_reason, revision, created_at";

export type EvidenceRow = Record<string, unknown> & { id: string; state?: string; uploaded_by?: string | null; object_path?: string | null };

/** Only finalized evidence is attached; prepared, uploaded and failed rows are never presented as evidence. */
export function isAttached(row: Pick<EvidenceRow, "state">) {
  return row.state === "finalized";
}

/** The uploader may see its own in-flight path to resume; nobody else ever receives a path. */
export function mayCarryPath(row: Pick<EvidenceRow, "state" | "uploaded_by">, actorId: string) {
  return row.uploaded_by === actorId && (row.state === "prepared" || row.state === "uploaded");
}

export function presentEvidence(row: EvidenceRow, actorId: string): Record<string, unknown> & { id: string } {
  const { object_path, ...rest } = withoutRequestHash(row) as Record<string, unknown> & { id: string; object_path?: string | null };
  return mayCarryPath(row, actorId) ? { ...rest, object_path: object_path ?? null } : rest;
}

/**
 * Database messages that are safe and useful to show the operator verbatim.
 * Each fragment covers one wording migration 343 raises: request-shape and
 * value problems (22023) and state, revision or replay refusals (P0001).
 */
const VALIDATION_FRAGMENTS = [
  "is required",
  "must be",
  "not editable",
  "carries no",
  "Evidence rule does not apply to this receipt",
  "Evidence kind does not match the rule",
  "Uploaded object does not match the prepared evidence",
  "sha256 does not match the prepared evidence",
];
/** Finalize refuses a row whose checksum Storage could not confirm; the uploader must re-read and fail or retry, so this is uncertain, not a conflict. */
export const CHECKSUM_UNVERIFIABLE_WORDING = "Evidence checksum could not be verified from the stored object";
const CONFLICT_FRAGMENTS = [
  "already saved with different content",
  "Receipt changed since it was read",
  "Evidence rule is already satisfied",
  "Evidence already finalized for these bytes",
  "Evidence is already finalized",
  "Evidence is already uploaded",
  "Evidence has failed",
  "Evidence belongs to another uploader",
  "Evidence attaches to the effective performance receipt",
  "Uploaded object not found for this evidence",
  "Linked record is not readable for this receipt",
];
const TRUSTED_FRAGMENTS = [...VALIDATION_FRAGMENTS, ...CONFLICT_FRAGMENTS, CHECKSUM_UNVERIFIABLE_WORDING];

export type EvidenceRpcError = { code?: string; message?: string; details?: string | null } | null | undefined;
export type MappedEvidenceError = { status: number; outcome: OutcomeClass; error: string; existing_evidence_id?: string };

const UUID_IN_DETAILS = /(?:existing_evidence_id|evidence_id)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const COMMAND_NOUN: Record<EvidenceCommand, string> = {
  prepare: "Evidence preparation",
  uploaded: "Upload confirmation",
  finalize: "Evidence finalization",
  fail: "Upload failure report",
};

/**
 * Bounded outcome classes: validation (400), denied (403, hides existence),
 * missing (404), conflict (409: stale receipt revision, changed replay,
 * wrong state, duplicate bytes; names the existing evidence when the
 * database does), uncertain (500; the client must re-read the evidence).
 * A finalize refused because the stored object's checksum could not be
 * verified is uncertain at 409: the row stays uploaded and the uploader
 * decides whether to fail it or retry with a fresh preparation.
 */
export function mapEvidenceRpcError(error: NonNullable<EvidenceRpcError>, command: EvidenceCommand): MappedEvidenceError {
  const message = error.message ?? "";
  const noun = COMMAND_NOUN[command];
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  const existing = UUID_IN_DETAILS.exec(`${error.details ?? ""} ${message}`)?.[1];
  const withExisting = (mapped: MappedEvidenceError): MappedEvidenceError => (existing ? { ...mapped, existing_evidence_id: existing } : mapped);
  if (error.code === "P0001" && message.includes(CHECKSUM_UNVERIFIABLE_WORDING)) return { status: 409, outcome: "uncertain", error: CHECKSUM_UNVERIFIABLE_WORDING };
  if (error.code === "42501") return { status: 403, outcome: "denied", error: "Operation unavailable" };
  if (error.code === "P0002") return { status: 404, outcome: "missing", error: "Evidence not found" };
  if (error.code === "22023") return { status: 400, outcome: "validation", error: trusted ? message : `${noun} contains an invalid value` };
  if (error.code === "23505") return withExisting({ status: 409, outcome: "conflict", error: trusted ? message : `${noun} conflicts with existing evidence` });
  if (error.code === "23514" || error.code === "P0001") {
    if (CONFLICT_FRAGMENTS.some((fragment) => message.includes(fragment))) return withExisting({ status: 409, outcome: "conflict", error: message });
    if (trusted && VALIDATION_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, outcome: "validation", error: message };
    return withExisting({ status: 409, outcome: "conflict", error: trusted ? message : `${noun} could not be completed. Refresh the evidence and retry.` });
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
    return { status: 400, outcome: "validation", error: `${noun} contains an invalid reference or value` };
  }
  return { status: 500, outcome: "uncertain", error: `${noun} could not be confirmed; re-read the evidence before retrying` };
}

export type EvidenceOutcome = {
  evidence: EvidenceRow;
  event: Record<string, unknown> & { id: string };
  replayed: boolean;
  satisfaction?: Record<string, unknown> | null;
  outcome: EvidenceResultOutcome;
};

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/** Every evidence command returns the evidence row, the event it wrote (or replayed), the replay flag and what it did; finalize adds the satisfaction outcome. */
export function isEvidenceOutcome(value: unknown): value is EvidenceOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { evidence?: unknown; event?: unknown; replayed?: unknown; satisfaction?: unknown; outcome?: unknown };
  const satisfactionOk = candidate.satisfaction === undefined || candidate.satisfaction === null || (typeof candidate.satisfaction === "object");
  const outcomeOk = typeof candidate.outcome === "string" && (EVIDENCE_RESULT_OUTCOMES as readonly string[]).includes(candidate.outcome);
  return hasId(candidate.evidence) && hasId(candidate.event) && typeof candidate.replayed === "boolean" && satisfactionOk && outcomeOk;
}

/**
 * The checksum outcomes are not exceptions in the database (the failure is
 * durable on the row) but they are not receipts either: a mismatch or a
 * changed object is a conflict with what was uploaded, an unverifiable
 * checksum is uncertain. Both return 409 with the evidence so the uploader
 * can reason about the retry. Every other outcome is a receipt.
 */
const RESULT_CLASSES: Partial<Record<EvidenceResultOutcome, { status: number; outcome: OutcomeClass; error: string }>> = {
  checksum_mismatch: { status: 409, outcome: "conflict", error: "Uploaded object does not match the declared checksum; the evidence has failed and a new preparation is needed" },
  object_changed: { status: 409, outcome: "conflict", error: "Stored object changed after it was uploaded; the evidence has failed and a new preparation is needed" },
  checksum_unverifiable: { status: 409, outcome: "uncertain", error: CHECKSUM_UNVERIFIABLE_WORDING },
};

/** Reply for a command result: outcome class, the evidence outcome, the presented row, its event and the replay flag; finalize adds satisfaction. */
export function evidenceResultReply(result: EvidenceOutcome, actorId: string, command: EvidenceCommand): { status: number; body: Record<string, unknown> } {
  const cls = RESULT_CLASSES[result.outcome];
  const body: Record<string, unknown> = {
    outcome: cls?.outcome ?? "receipt",
    evidence_outcome: result.outcome,
    ...(cls ? { error: cls.error } : {}),
    evidence: presentEvidence(result.evidence, actorId),
    event: withoutRequestHash(result.event),
    replayed: result.replayed,
    ...(command === "finalize" || command === "prepare" ? { satisfaction: result.satisfaction ?? null } : {}),
  };
  return { status: cls?.status ?? 200, body };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EvidenceTarget = { id: string; organization_id: string; facility_id: string; state: string; uploaded_by: string | null; object_path: string | null; evidence_kind: string };

/**
 * Session read of one evidence row: RLS hides other sites, restricted
 * subjects and other uploaders' in-flight rows, and the current site grant
 * is checked before anything else is done with it.
 */
export async function readEvidenceTarget(actor: OperationsActor, id: string, scope: string): Promise<{ target: EvidenceTarget } | { response: NextResponse }> {
  if (!UUID.test(id)) return { response: NextResponse.json({ error: "Evidence not found", outcome: "missing" }, { status: 404 }) };
  const { data: row, error: readError } = await actor.currentActor.client
    .from("operation_evidence" as never)
    .select("id, organization_id, facility_id, state, uploaded_by, object_path, evidence_kind")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError(scope, readError, { action: "read", evidenceId: id });
    return { response: NextResponse.json({ error: "Evidence unavailable", outcome: "uncertain" }, { status: 503 }) };
  }
  const target = row as EvidenceTarget | null;
  if (!target || target.organization_id !== actor.organizationId || !(await actorCanAccessFacility(actor, target.facility_id))) {
    return { response: NextResponse.json({ error: "Evidence not found", outcome: "missing" }, { status: 404 }) };
  }
  return { target };
}

type CommandArgs = { request_key: string; expected_receipt_revision?: string; payload?: Record<string, unknown> };

const COMMAND_SCHEMAS = {
  uploaded: uploadedEvidenceBodySchema,
  finalize: finalizeEvidenceBodySchema,
  fail: failEvidenceBodySchema,
} as const;

function rpcArgs(command: Exclude<EvidenceCommand, "prepare">, id: string, body: CommandArgs) {
  if (command === "uploaded") return { p_evidence: id, p_request_key: body.request_key };
  if (command === "finalize") return { p_evidence: id, p_request_key: body.request_key, p_expected_receipt_revision: body.expected_receipt_revision, p_payload: body.payload ?? {} };
  return { p_evidence: id, p_request_key: body.request_key, p_payload: body.payload ?? {} };
}

/**
 * Shared flow for the uploaded, finalize and fail routes: uuid guard, session
 * actor, strict body, session read of the evidence, current site grant,
 * revalidation, command, bounded mapping. Replies strip the request hash and
 * carry no object path for anyone but the uploader of an in-flight row.
 */
export async function runEvidenceCommand(command: Exclude<EvidenceCommand, "prepare">, request: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Evidence not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: EVIDENCE_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = COMMAND_SCHEMAS[command].safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: evidencePayloadProblem(parsed.error) ?? COMMAND_FALLBACK[command], outcome: "validation" }, { status: 400 });
  }
  const scope = `admin.operations.evidence.${command}`;
  const read = await readEvidenceTarget(auth.actor, id, scope);
  if ("response" in read) return read.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(EVIDENCE_COMMAND_RPC[command] as never, rpcArgs(command, id, parsed.data as CommandArgs) as never);
  if (error) {
    logError(scope, error, { action: "rpc", evidenceId: id });
    const mapped = mapEvidenceRpcError(error, command);
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...(mapped.existing_evidence_id ? { existing_evidence_id: mapped.existing_evidence_id } : {}) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isEvidenceOutcome(result)) {
    return NextResponse.json({ error: `${COMMAND_NOUN[command]} could not be confirmed; re-read the evidence before retrying`, outcome: "uncertain" }, { status: 500 });
  }
  const reply = evidenceResultReply(result, current.actor.id, command);
  return NextResponse.json(reply.body, { status: reply.status });
}
