import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import {
  REQUIREMENT_FACILITY_ROLES,
  REQUIREMENT_VIEW_ROLES,
  isRequirementRecord,
  mapRequirementRpcError,
  saveFacilityRequirementDraftBodySchema,
} from "@/lib/operations/requirements";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Facility requirement configurations for a site (optionally one activity), through the session. */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const facilityId = request.nextUrl.searchParams.get("facility_id");
  const activityId = request.nextUrl.searchParams.get("activity_id");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (activityId && !UUID.test(activityId)) return NextResponse.json({ error: "activity_id is invalid" }, { status: 400 });
  // Facility selection is not an authorization boundary; the current site grant is.
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  let query = auth.actor.currentActor.client
    .from("operation_facility_requirements" as never)
    .select("id, facility_id, activity_id, requirement_version_id, version, status, effective_from, effective_to, applicability, applicability_reason, override_source, local_procedure, local_allowed_recorder_roles, local_required_inputs, local_required_evidence, owner_role, owner_user_id, backup_role, backup_user_id, schedule_status, schedule_rule, previous_version_id, approved_by, approved_at, created_at, updated_at")
    .eq("organization_id", auth.actor.organizationId)
    .eq("facility_id", facilityId);
  if (activityId) query = query.eq("activity_id", activityId);
  const { data, error } = await query.order("activity_id", { ascending: true }).order("version", { ascending: false });
  if (error) {
    logError("admin.operations.facility-requirements.list", error, { action: "list", facilityId });
    return NextResponse.json({ error: "Facility requirements unavailable" }, { status: 503 });
  }
  return NextResponse.json({ configurations: data ?? [] });
}

/** Create or update the single site draft for an activity. Authority is rechecked in the database. */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_FACILITY_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = saveFacilityRequirementDraftBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide an activity, a facility and an editable site draft payload" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "save_operation_facility_requirement_draft_review" as never,
    { p_activity_id: parsed.data.activity_id, p_facility_id: parsed.data.facility_id, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.facility-requirements.draft", error, { action: "rpc", facilityId: parsed.data.facility_id, activityId: parsed.data.activity_id });
    const mapped = mapRequirementRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isRequirementRecord(data)) {
    return NextResponse.json({ error: "Facility requirement draft could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json({ configuration: data });
}
