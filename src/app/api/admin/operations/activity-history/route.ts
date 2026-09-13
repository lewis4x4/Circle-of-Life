import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { composeCorporateHistory } from "@/lib/operations/corporate-history";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const facilityId = params.get("facility_id"), activityId = params.get("activity_id"), cursor = params.get("cursor");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (activityId !== null && !UUID.test(activityId)) return NextResponse.json({ error: "activity_id is invalid" }, { status: 400 });
  if (cursor !== null && (!activityId || !cursor)) return NextResponse.json({ error: "cursor requires an activity" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  const now = new Date();
  const outcome = await composeCorporateHistory({ actor: auth.actor, facilityId, activityId, cursor, now });
  // Recheck identity/site, then bracket all projections through current subject RLS.
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (!actorCanViewOperations(current.actor) || !(await actorCanAccessFacility(current.actor, facilityId))) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  if (current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole) return NextResponse.json({ error: "Authority changed; reload activity history" }, { status: 503 });
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  const fresh = await composeCorporateHistory({ actor: current.actor, facilityId, activityId, cursor, now });
  if (fresh.status !== 200) return NextResponse.json({ error: fresh.error }, { status: fresh.status });
  if (JSON.stringify(fresh.body) !== JSON.stringify(outcome.body)) return NextResponse.json({ error: "Activity history changed; reload to see current records" }, { status: 503 });
  return NextResponse.json(fresh.body);
}
