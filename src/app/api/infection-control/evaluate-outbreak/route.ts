import { NextResponse } from "next/server";
import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { runOutbreakDetectionAfterSurveillance } from "@/lib/infection-control/outbreak-detection";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type Body = { surveillanceId?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const surveillanceId = body.surveillanceId?.trim();
  if (!surveillanceId) {
    return NextResponse.json({ error: "surveillanceId is required" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "nurse"],
    scope: "infection-control.evaluate-outbreak",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const { data: surv, error: sErr } = await admin
    .from("infection_surveillance")
    .select("facility_id, organization_id")
    .eq("id", surveillanceId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sErr || !surv) {
    return NextResponse.json({ error: "Surveillance record not found" }, { status: 404 });
  }

  const okFac = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: surv.facility_id,
    organizationId: actor.organizationId,
  });

  if (!okFac) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ["owner", "org_admin", "facility_admin", "nurse"],
    scope: "infection-control.evaluate-outbreak.revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (currentActor.organizationId !== surv.organization_id) {
    return NextResponse.json({ error: "Surveillance record not found" }, { status: 404 });
  }
  const stillHasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: currentActor.id,
    facilityId: surv.facility_id,
    organizationId: currentActor.organizationId,
  });
  if (!stillHasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const outcome = await runOutbreakDetectionAfterSurveillance(admin, surveillanceId, currentActor.id);

  return NextResponse.json({ ok: true, outcome: outcome.outcome });
}
