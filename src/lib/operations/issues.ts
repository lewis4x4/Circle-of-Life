import { NextResponse } from "next/server";
import { z } from "zod";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { requestKeySchema } from "@/lib/operations/occurrences";
import { withoutRequestHash, type OutcomeClass } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";
import { ALL_APP_ROLES } from "@/lib/rbac";

/**
 * COL-144 issue lifecycle on the COL-142 issue identity. The database owns
 * authority, the expected-revision check, idempotency and every transition
 * rule; these helpers shape requests, run the shared route flow and map
 * database outcomes to the bounded server-authoritative classes without
 * echoing internals. No command here touches a receipt or an occurrence.
 */

export const ISSUE_VIEW_ROLES = OPERATIONS_VIEW_ROLES;
export const ISSUE_COMMAND_ROLES = OPERATIONS_VIEW_ROLES;

export const ISSUE_STATUSES = ["open", "assigned", "waiting", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_EVENT_KINDS = ["assigned", "reassigned", "accepted", "covered", "waiting", "resumed", "resolved", "reopened", "linked"] as const;
export const ISSUE_COMMANDS = ["assign", "accept", "wait", "resume", "resolve", "reopen", "link"] as const;
export type IssueCommand = (typeof ISSUE_COMMANDS)[number];

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const appRole = z.enum(ALL_APP_ROLES as unknown as [string, ...string[]]);
/** The issue fingerprint the client read; the database refuses a stale one. */
export const expectedRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected_revision must be the issue revision");

export const assignPayloadSchema = z
  .object({
    owner_user_id: uuid.optional(),
    owner_role: appRole.optional(),
    backup_user_id: uuid.optional(),
    backup_role: appRole.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (!payload.owner_user_id && !payload.owner_role) ctx.addIssue({ code: "custom", message: "Assignment needs an owner" });
  });
export const acceptPayloadSchema = z.object({ note: z.string().trim().max(2000).optional(), cover_reason: text(2000).optional() }).strict();
export const waitPayloadSchema = z
  .object({ reason: text(2000), follow_up_at: instant })
  .strict()
  .superRefine((payload, ctx) => {
    if (new Date(payload.follow_up_at).getTime() < Date.now()) ctx.addIssue({ code: "custom", message: "follow_up_at must be in the future" });
  });
export const resumePayloadSchema = z.object({ note: z.string().trim().max(2000).optional() }).strict();
export const resolvePayloadSchema = z.object({ resolution_summary: text(4000), resolution_receipt_id: uuid.optional() }).strict();
export const reopenPayloadSchema = z.object({ reason: text(2000) }).strict();
export const linkPayloadSchema = z.object({ receipt_id: uuid }).strict();

function commandBody<T extends z.ZodTypeAny>(payload: T) {
  return z.object({ request_key: requestKeySchema, expected_revision: expectedRevisionSchema, payload }).strict();
}

export const ISSUE_COMMAND_SCHEMAS = {
  assign: commandBody(assignPayloadSchema),
  accept: commandBody(acceptPayloadSchema),
  wait: commandBody(waitPayloadSchema),
  resume: commandBody(resumePayloadSchema),
  resolve: commandBody(resolvePayloadSchema),
  reopen: commandBody(reopenPayloadSchema),
  link: commandBody(linkPayloadSchema),
} as const;

export const ISSUE_COMMAND_RPC: Record<IssueCommand, string> = {
  assign: "assign_operation_issue_review",
  accept: "accept_operation_issue_review",
  wait: "wait_operation_issue_review",
  resume: "resume_operation_issue_review",
  resolve: "resolve_operation_issue_review",
  reopen: "reopen_operation_issue_review",
  link: "link_operation_issue_review",
};

const COMMAND_FALLBACK: Record<IssueCommand, string> = {
  assign: "Provide a request key, the issue revision and an owner",
  accept: "Provide a request key and the issue revision",
  wait: "Provide a request key, the issue revision, a reason and a follow-up time",
  resume: "Provide a request key and the issue revision",
  resolve: "Provide a request key, the issue revision and a resolution summary",
  reopen: "Provide a request key, the issue revision and a reason",
  link: "Provide a request key, the issue revision and a receipt",
};

/** The first payload problem in words the operator can act on. */
export function issuePayloadProblem(error: z.ZodError): string | null {
  const custom = error.issues.find((candidate) => candidate.code === "custom");
  if (custom) return custom.message;
  const first = error.issues[0];
  if (!first) return null;
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** COL-142 identity plus the COL-144 lifecycle projection. */
export const ISSUE_LIFECYCLE_SELECT =
  "id, organization_id, facility_id, activity_id, subject_id, authority_class, task_instance_id, receipt_id, issue_kind, summary, severity, status, reported_by, reported_role, reported_at, owner_user_id, owner_role, backup_user_id, backup_role, assigned_at, accepted_at, accepted_by, waiting_reason, follow_up_at, resolved_at, resolved_by, resolution_summary, resolution_receipt_id, reopen_count, issue_revision, updated_at, created_at";

export const ISSUE_EVENT_SELECT =
  "id, organization_id, facility_id, issue_id, event_seq, event_kind, from_status, to_status, actor_id, actor_role, expected_revision, request_key, details, created_at";

/**
 * Database messages that are safe and useful to show the operator verbatim.
 * Each fragment covers one wording migration 342 raises: request-shape and
 * value problems (22023) and state, revision or replay refusals (P0001).
 */
const VALIDATION_FRAGMENTS = [
  "is required",
  "must be",
  "not editable",
  "is not current staff at this site",
  "Backup must differ from the owner",
  "Covering for a current owner requires cover_reason",
  "requires",
  "readable performance receipt for this subject",
];
const CONFLICT_FRAGMENTS = [
  "already saved with different content",
  "Issue changed since it was read",
  "Issue cannot",
  "Issue is resolved",
  "Issue is not assigned",
  "Issue is not waiting",
  "Issue is not resolved",
  "Issue is already accepted",
  "Issue is already linked to a receipt",
];
const TRUSTED_FRAGMENTS = [...VALIDATION_FRAGMENTS, ...CONFLICT_FRAGMENTS];

export type IssueRpcError = { code?: string; message?: string; details?: string | null } | null | undefined;
export type MappedIssueError = { status: number; outcome: OutcomeClass; error: string };

const COMMAND_NOUN: Record<IssueCommand, string> = {
  assign: "Assignment",
  accept: "Acceptance",
  wait: "Waiting request",
  resume: "Resume request",
  resolve: "Resolution",
  reopen: "Reopen request",
  link: "Receipt link",
};

/**
 * Bounded outcome classes: validation (400), denied (403, hides existence),
 * missing (404), conflict (409: stale revision, changed replay, wrong status,
 * ownership rule), uncertain (500; the client must re-read the issue).
 */
export function mapIssueRpcError(error: NonNullable<IssueRpcError>, command: IssueCommand): MappedIssueError {
  const message = error.message ?? "";
  const noun = COMMAND_NOUN[command];
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  if (error.code === "42501") return { status: 403, outcome: "denied", error: "Operation unavailable" };
  if (error.code === "P0002") return { status: 404, outcome: "missing", error: "Issue not found" };
  if (error.code === "22023") return { status: 400, outcome: "validation", error: trusted ? message : `${noun} contains an invalid value` };
  if (error.code === "23505") return { status: 409, outcome: "conflict", error: trusted ? message : `${noun} conflicts with an existing event` };
  if (error.code === "23514" || error.code === "P0001") {
    if (CONFLICT_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 409, outcome: "conflict", error: message };
    if (trusted && VALIDATION_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, outcome: "validation", error: message };
    return { status: 409, outcome: "conflict", error: trusted ? message : `${noun} could not be completed. Refresh the issue and retry.` };
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "23503") {
    return { status: 400, outcome: "validation", error: `${noun} contains an invalid reference or value` };
  }
  return { status: 500, outcome: "uncertain", error: `${noun} could not be confirmed; re-read the issue before retrying` };
}

export type IssueEventOutcome = {
  issue: Record<string, unknown> & { id: string };
  event: Record<string, unknown> & { id: string };
  replayed: boolean;
};

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/** Every lifecycle command returns the issue projection, the event it wrote (or replayed) and the replay flag. */
export function isIssueEventOutcome(value: unknown): value is IssueEventOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { issue?: unknown; event?: unknown; replayed?: unknown };
  return hasId(candidate.issue) && hasId(candidate.event) && typeof candidate.replayed === "boolean";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IssueTarget = { id: string; organization_id: string; facility_id: string };

/**
 * Shared flow for every lifecycle route: uuid guard, session actor, strict
 * body, session read of the issue (RLS hides other sites and restricted
 * subjects), current site grant, revalidation, command, bounded mapping.
 */
export async function runIssueCommand(command: IssueCommand, request: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Issue not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: ISSUE_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = ISSUE_COMMAND_SCHEMAS[command].safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: issuePayloadProblem(parsed.error) ?? COMMAND_FALLBACK[command], outcome: "validation" }, { status: 400 });
  }
  const scope = `admin.operations.issues.${command}`;
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_issues" as never)
    .select("id, organization_id, facility_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError(scope, readError, { action: "read", issueId: id });
    return NextResponse.json({ error: "Issue unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const target = row as IssueTarget | null;
  if (!target || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Issue not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    ISSUE_COMMAND_RPC[command] as never,
    { p_issue: id, p_request_key: parsed.data.request_key, p_expected_revision: parsed.data.expected_revision, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError(scope, error, { action: "rpc", issueId: id });
    const mapped = mapIssueRpcError(error, command);
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isIssueEventOutcome(result)) {
    return NextResponse.json({ error: `${COMMAND_NOUN[command]} could not be confirmed; re-read the issue before retrying`, outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json({ outcome: "event", issue: withoutRequestHash(result.issue), event: withoutRequestHash(result.event), replayed: result.replayed });
}
