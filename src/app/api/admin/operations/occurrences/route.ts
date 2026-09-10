import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { OCCURRENCE_SELECT, OCCURRENCE_VIEW_ROLES } from "@/lib/operations/occurrences";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Managed occurrences for a site (COL-139): identity, period, pinned
 * versions, evaluator snapshot and revision, read through the session so the
 * current subject and site authority governs every row.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: OCCURRENCE_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const facilityId = params.get("facility_id");
  const activityId = params.get("activity_id");
  const subjectId = params.get("subject_id");
  const dateFrom = params.get("date_from");
  const dateTo = params.get("date_to");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (activityId && !UUID.test(activityId)) return NextResponse.json({ error: "activity_id is invalid" }, { status: 400 });
  if (subjectId && !UUID.test(subjectId)) return NextResponse.json({ error: "subject_id is invalid" }, { status: 400 });
  if ((dateFrom && !DATE.test(dateFrom)) || (dateTo && !DATE.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return NextResponse.json({ error: "date range is invalid" }, { status: 400 });
  }
  // Facility selection is not an authorization boundary; the current site grant is.
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  let query = auth.actor.currentActor.client
    .from("operation_task_instances" as never)
    .select(OCCURRENCE_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("facility_id", facilityId)
    .not("occurrence_kind", "is", null)
    .is("deleted_at", null);
  if (activityId) query = query.eq("activity_id", activityId);
  if (subjectId) query = query.eq("subject_id", subjectId);
  if (dateFrom) query = query.gte("assigned_shift_date", dateFrom);
  if (dateTo) query = query.lte("assigned_shift_date", dateTo);
  const { data, error } = await query.order("assigned_shift_date", { ascending: true }).order("created_at", { ascending: true });
  if (error) {
    logError("admin.operations.occurrences.list", error, { action: "list", facilityId });
    return NextResponse.json({ error: "Occurrences unavailable" }, { status: 503 });
  }
  return NextResponse.json({ occurrences: data ?? [] });
}
