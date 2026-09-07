import { NextResponse } from "next/server";
import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { evaluateVitalSignAlertsForDailyLog } from "@/lib/infection-control/evaluate-vitals";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import type { Database } from "@/types/database";

type Body = { dailyLogId?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dailyLogId = body.dailyLogId?.trim();
  if (!dailyLogId) {
    return NextResponse.json({ error: "dailyLogId is required" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "nurse", "caregiver"],
    scope: "infection-control.evaluate-vitals",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const { data: log, error: logErr } = await admin
    .from("daily_logs")
    .select("id, organization_id, facility_id, resident_id, log_date, logged_by, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, respiration, oxygen_saturation, weight_lbs")
    .eq("id", dailyLogId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (logErr || !log) {
    return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  }

  const row = log as Database["public"]["Tables"]["daily_logs"]["Row"];

  const okFac = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: row.facility_id,
    organizationId: actor.organizationId,
  });

  if (!okFac) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ["owner", "org_admin", "facility_admin", "nurse", "caregiver"],
    scope: "infection-control.evaluate-vitals.revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (currentActor.organizationId !== row.organization_id) {
    return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  }
  const stillHasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: currentActor.id,
    facilityId: row.facility_id,
    organizationId: currentActor.organizationId,
  });
  if (!stillHasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const adminRoles = new Set(["owner", "org_admin", "facility_admin", "nurse"]);
  if (!adminRoles.has(currentActor.appRole) && row.logged_by !== currentActor.id) {
    return NextResponse.json({ error: "Not allowed to evaluate vitals for this log" }, { status: 403 });
  }

  const result = await evaluateVitalSignAlertsForDailyLog(admin, row);

  return NextResponse.json({
    ok: true,
    alertsCreated: result.alertsCreated,
    skippedReason: result.skippedReason,
  });
}
