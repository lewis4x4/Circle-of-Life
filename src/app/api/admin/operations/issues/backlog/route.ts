import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { ISSUE_VIEW_ROLES } from "@/lib/operations/issues";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The projection holds unresolved work only; resolved issues are read from the list route. */
const BACKLOG_STATUSES = ["open", "assigned", "waiting"] as const;

/**
 * The in-app backlog for a site (COL-144): every unresolved issue with
 * whether its owner and backup are still current, whether a waiting
 * follow-up is overdue, and the linked occurrence's execution state. Read
 * through the session projection, so unassigned, waiting and reassigned
 * work is visible only under current site and subject authority.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: ISSUE_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const facilityId = request.nextUrl.searchParams.get("facility_id");
  const status = request.nextUrl.searchParams.get("status");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (status && !(BACKLOG_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "status is invalid" }, { status: 400 });
  // Facility selection is not an authorization boundary; the current site grant is.
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  let query = auth.actor.currentActor.client
    .from("operation_issue_backlog" as never)
    .select("*")
    .eq("organization_id", auth.actor.organizationId)
    .eq("facility_id", facilityId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("reported_at", { ascending: true });
  if (error) {
    logError("admin.operations.issues.backlog", error, { action: "list", facilityId });
    return NextResponse.json({ error: "Backlog unavailable" }, { status: 503 });
  }
  return NextResponse.json({ backlog: data ?? [] });
}
