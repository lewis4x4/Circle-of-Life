import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import {
  BINDING_COMMAND_ROLES,
  BINDING_SELECT,
  BINDING_VIEW_ROLES,
  enrollBindingBodySchema,
  isBindingRecord,
  mapOccurrenceRpcError,
} from "@/lib/operations/occurrences";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Activity/site/subject bindings for a site (optionally one activity), through the session. */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: BINDING_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const facilityId = request.nextUrl.searchParams.get("facility_id");
  const activityId = request.nextUrl.searchParams.get("activity_id");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (activityId && !UUID.test(activityId)) return NextResponse.json({ error: "activity_id is invalid" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  let query = auth.actor.currentActor.client
    .from("operation_activity_bindings" as never)
    .select(BINDING_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("facility_id", facilityId);
  if (activityId) query = query.eq("activity_id", activityId);
  const { data, error } = await query.order("activity_id", { ascending: true }).order("effective_from", { ascending: false });
  if (error) {
    logError("admin.operations.occurrences.bindings.list", error, { action: "list", facilityId });
    return NextResponse.json({ error: "Bindings unavailable" }, { status: 503 });
  }
  return NextResponse.json({ bindings: data ?? [] });
}

/** Enrol one typed subject in one activity at one site. Authority is rechecked in the database. */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: BINDING_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = enrollBindingBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide an activity, a site, a typed subject, its authority class, provenance and an effective time" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "enroll_operation_binding_review" as never,
    {
      p_activity: parsed.data.activity_id,
      p_facility: parsed.data.facility_id,
      p_subject: parsed.data.subject_id,
      p_authority_class: parsed.data.authority_class,
      p_shift: parsed.data.shift ?? null,
      p_provenance: parsed.data.provenance,
      p_effective_from: parsed.data.effective_from,
    } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.bindings.enroll", error, { action: "rpc", facilityId: parsed.data.facility_id, activityId: parsed.data.activity_id });
    const mapped = mapOccurrenceRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isBindingRecord(data)) return NextResponse.json({ error: "Binding could not be confirmed" }, { status: 500 });
  return NextResponse.json({ binding: data });
}
