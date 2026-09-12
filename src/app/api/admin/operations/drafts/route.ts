import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "@/lib/operations/auth";
import {
  DRAFT_COMMAND_ROLES,
  DRAFT_LIST_LIMIT,
  DRAFT_LIST_SELECT,
  DRAFT_RPC,
  DRAFT_STATES,
  DRAFT_VIEW_ROLES,
  draftPayloadProblem,
  isSaveDraftOutcome,
  mapDraftRpcError,
  presentDraft,
  saveDraftBodySchema,
  type DraftRow,
  type SaveDraftBody,
} from "@/lib/operations/recovery";
import { logError } from "@/lib/observability/logger";

const SCOPE = "admin.operations.drafts";

/**
 * The caller's own drafts (COL-146), read through the session so the current
 * site and subject authority governs every row; newest first, at most 50,
 * without arguments. A pending draft past its expiry reads as expired.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: DRAFT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const state = request.nextUrl.searchParams.get("state") ?? "pending";
  if (!(DRAFT_STATES as readonly string[]).includes(state)) return NextResponse.json({ error: "state is invalid" }, { status: 400 });
  const { data, error } = await auth.actor.currentActor.client
    .from("operation_command_drafts" as never)
    .select(DRAFT_LIST_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("actor_id", auth.actor.id)
    .eq("state", state)
    .order("created_at", { ascending: false })
    .limit(DRAFT_LIST_LIMIT);
  if (error) {
    logError(`${SCOPE}.list`, error, { action: "list", state });
    return NextResponse.json({ error: "Drafts unavailable" }, { status: 503 });
  }
  const now = Date.now();
  return NextResponse.json({ drafts: ((data ?? []) as DraftRow[]).map((draft) => presentDraft(draft, now)) });
}

type OccurrenceTarget = { id: string; facility_id: string; organization_id: string; occurrence_kind: string | null };

/** The session read hides occurrences for sites and subjects without a current grant; legacy rows are never drafted. */
async function readOccurrence(actor: OperationsActor, id: string, requireManaged: boolean): Promise<{ facilityId: string } | { response: NextResponse }> {
  const { data: row, error: readError } = await actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, facility_id, organization_id, occurrence_kind")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    logError(`${SCOPE}.save`, readError, { action: "read", occurrenceId: id });
    return { response: NextResponse.json({ error: "Occurrence unavailable", outcome: "uncertain" }, { status: 503 }) };
  }
  const target = row as OccurrenceTarget | null;
  if (!target || (requireManaged && !target.occurrence_kind) || target.organization_id !== actor.organizationId || !(await actorCanAccessFacility(actor, target.facility_id))) {
    return { response: NextResponse.json({ error: "Occurrence not found", outcome: "missing" }, { status: 404 }) };
  }
  return { facilityId: target.facility_id };
}

/** The draft's target and site follow the command's own target rules, checked through the session before the command. */
async function resolveDraftScope(actor: OperationsActor, body: SaveDraftBody): Promise<{ targetId: string | null; facilityId: string | null } | { response: NextResponse }> {
  if (body.command !== "report_issue") {
    const read = await readOccurrence(actor, body.target_id, true);
    return "response" in read ? read : { targetId: body.target_id, facilityId: null };
  }
  const payload = body.arguments.payload;
  if (payload.task_instance_id) {
    const read = await readOccurrence(actor, payload.task_instance_id, false);
    return "response" in read ? read : { targetId: payload.task_instance_id, facilityId: null };
  }
  if (!payload.facility_id || !(await actorCanAccessFacility(actor, payload.facility_id))) {
    return { response: NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 }) };
  }
  return { targetId: null, facilityId: payload.facility_id };
}

/**
 * Save a draft of one command before issuing it (COL-146). The database
 * stores the arguments under the actor's own identity with the request key
 * the command will use; one key and one content fingerprint yield one draft.
 * Nothing in a draft grants anything: reading it back or resuming it runs
 * the command's own authority checks.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: DRAFT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = saveDraftBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: draftPayloadProblem(parsed.error) ?? "Provide a request key, a command, its target and its arguments", outcome: "validation" }, { status: 400 });
  }
  const scope = await resolveDraftScope(auth.actor, parsed.data);
  if ("response" in scope) return scope.response;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const payload = {
    command: parsed.data.command,
    ...(scope.targetId ? { target_id: scope.targetId } : {}),
    ...(scope.facilityId ? { facility_id: scope.facilityId } : {}),
    arguments: parsed.data.arguments,
  };
  const { data, error } = await current.actor.currentActor.client.rpc(DRAFT_RPC.save as never, { p_request_key: parsed.data.request_key, p_payload: payload } as never);
  if (error) {
    logError(`${SCOPE}.save`, error, { action: "rpc", command: parsed.data.command });
    const mapped = mapDraftRpcError(error, "save");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSaveDraftOutcome(result)) return NextResponse.json({ error: "Draft could not be confirmed; nothing was saved", outcome: "uncertain" }, { status: 500 });
  return NextResponse.json({ draft: presentDraft(result.draft), replayed: result.replayed });
}
