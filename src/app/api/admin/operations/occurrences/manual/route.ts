import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OCCURRENCE_COMMAND_ROLES, isOccurrenceRecord, manualOccurrenceBodySchema, mapOccurrenceRpcError } from "@/lib/operations/occurrences";
import { logError } from "@/lib/observability/logger";

/**
 * Manual unscheduled occurrence (COL-139): no invented period or deadline; a
 * labelled compatibility queue date only. The database decides recording
 * authority, pins the versions in force now and detects request replays.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: OCCURRENCE_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = manualOccurrenceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide an activity, a site, a typed subject, a request key and an editable payload" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "create_operation_manual_occurrence_review" as never,
    {
      p_activity: parsed.data.activity_id,
      p_facility: parsed.data.facility_id,
      p_subject: parsed.data.subject_id,
      p_request_key: parsed.data.request_key,
      p_payload: parsed.data.payload,
    } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.manual", error, { action: "rpc", facilityId: parsed.data.facility_id, activityId: parsed.data.activity_id });
    const mapped = mapOccurrenceRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isOccurrenceRecord(data)) return NextResponse.json({ error: "Occurrence could not be confirmed" }, { status: 500 });
  return NextResponse.json({ occurrence: data });
}
