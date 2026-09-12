import { NextResponse } from "next/server";

import { actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds, requireOperationsActor } from "@/lib/operations/auth";

export async function GET(request: Request) {
  const auth = await requireOperationsActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  if (!actorCanViewOperations(actor)) return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  let facilityIds: string[];
  try {
    facilityIds = await listActorAccessibleFacilityIds(actor);
  } catch {
    return NextResponse.json({ error: "Could not verify facility access" }, { status: 503 });
  }
  const facilityId = new URL(request.url).searchParams.get("facility_id") ?? facilityIds[0];
  if (!facilityId || !(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility unavailable" }, { status: 403 });
  }
  // RLS deliberately hides restricted subjects. A visible subset cannot establish
  // whole-site workload coverage or support a staffing/all-clear conclusion.
  return NextResponse.json({
    error: "Staffing workload assessment requires verified aggregate coverage",
    coverage: { scope: "currently_authorized_classified_tasks", completeness: "unverified" },
  }, { status: 409 });
}
