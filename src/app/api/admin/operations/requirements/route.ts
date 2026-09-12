import { NextRequest, NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import {
  REQUIREMENT_CENTRAL_ROLES,
  REQUIREMENT_VIEW_ROLES,
  isRequirementRecord,
  mapRequirementRpcError,
  saveRequirementDraftBodySchema,
} from "@/lib/operations/requirements";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Central requirement versions for one activity, through the session (RLS hides drafts from non-publishers). */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const activityId = request.nextUrl.searchParams.get("activity_id");
  if (!activityId || !UUID.test(activityId)) {
    return NextResponse.json({ error: "activity_id is required" }, { status: 400 });
  }
  const { data, error } = await auth.actor.currentActor.client
    .from("operation_requirement_versions" as never)
    .select("id, activity_id, version, status, effective_from, effective_to, title, wording, procedure, source_authority, subject_kind, allowed_recorder_roles, allowed_reviewer_roles, review_required, required_inputs, required_evidence, previous_version_id, published_by, published_at, created_at, updated_at")
    .eq("organization_id", auth.actor.organizationId)
    .eq("activity_id", activityId)
    .order("version", { ascending: false });
  if (error) {
    logError("admin.operations.requirements.list", error, { action: "list", activityId });
    return NextResponse.json({ error: "Requirement versions unavailable" }, { status: 503 });
  }
  return NextResponse.json({ versions: data ?? [] });
}

/** Create or update the single draft for an activity. The database owns validation and authority. */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_CENTRAL_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = saveRequirementDraftBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide an activity and an editable requirement draft payload" }, { status: 400 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "save_operation_requirement_draft_review" as never,
    { p_activity_id: parsed.data.activity_id, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.requirements.draft", error, { action: "rpc", activityId: parsed.data.activity_id });
    const mapped = mapRequirementRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isRequirementRecord(data)) {
    return NextResponse.json({ error: "Requirement draft could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json({ version: data });
}
