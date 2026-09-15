import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

// Same roles the table's UPDATE policy names (035).
const ALERT_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const;
const DISMISS_NOTE_MIN = 3;

type Body = { action?: unknown; notes?: unknown };

type AlertRow = {
  id: string;
  care_plan_id: string;
  resident_id: string;
  facility_id: string;
  organization_id: string;
  trigger_type: string;
  status: string;
};

/**
 * PATCH /api/care-plans/review-alerts/[id] — acknowledge (someone has seen it) or
 * dismiss (with a reason) one review alert. Resolution itself is not a button:
 * a new active plan version resolves the older plan's alerts (migration 394).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: alertId } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action === "acknowledge" || body.action === "dismiss" ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "action must be acknowledge or dismiss" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (action === "dismiss" && notes.length < DISMISS_NOTE_MIN) {
    return NextResponse.json({ error: "Dismissing an alert needs a reason" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({ allowedRoles: ALERT_ROLES, scope: "care-plans.review-alerts" });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const alertResult = (await admin
    .from("care_plan_review_alerts")
    .select("id, care_plan_id, resident_id, facility_id, organization_id, trigger_type, status")
    .eq("id", alertId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as { data: AlertRow | null; error: { message: string } | null };
  if (alertResult.error || !alertResult.data) {
    return NextResponse.json({ error: "Review alert not found" }, { status: 404 });
  }
  const alert = alertResult.data;

  const hasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: alert.facility_id,
    organizationId: actor.organizationId,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "You do not have access to this review alert" }, { status: 403 });
  }

  if (action === "acknowledge" && alert.status !== "open") {
    return NextResponse.json({ error: `Alert is already ${alert.status}` }, { status: 409 });
  }
  if (action === "dismiss" && alert.status !== "open" && alert.status !== "acknowledged") {
    return NextResponse.json({ error: `Alert is already ${alert.status}` }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const patch =
    action === "acknowledge"
      ? { status: "acknowledged", acknowledged_by: actor.id, acknowledged_at: nowIso }
      : { status: "dismissed", resolved_by: actor.id, resolved_at: nowIso, resolution_notes: notes };

  const updateResult = (await admin
    .from("care_plan_review_alerts")
    .update(patch)
    .eq("id", alert.id)
    .eq("organization_id", alert.organization_id)
    .eq("status", alert.status)
    .is("deleted_at", null)
    .select("id, status")
    .maybeSingle()) as unknown as { data: { id: string; status: string } | null; error: { message: string } | null };

  if (updateResult.error) {
    logError("care-plans.review-alerts", updateResult.error, { action, alertId });
    return NextResponse.json({ error: "Review alert could not be updated" }, { status: 500 });
  }
  if (!updateResult.data) {
    return NextResponse.json({ error: "Alert state changed; refresh and try again" }, { status: 409 });
  }

  const { error: auditError } = await admin.from("audit_log").insert({
    table_name: "care_plan_review_alerts",
    record_id: alert.id,
    action: "UPDATE",
    new_data: {
      event: `care_plan_review_alert_${action}d`,
      previous_status: alert.status,
      new_status: updateResult.data.status,
      trigger_type: alert.trigger_type,
      care_plan_id: alert.care_plan_id,
      resident_id: alert.resident_id,
      ...(action === "dismiss" ? { resolution_notes: notes } : {}),
    },
    user_id: actor.id,
    organization_id: alert.organization_id,
    facility_id: alert.facility_id,
  });
  if (auditError) {
    logError("care-plans.review-alerts", auditError, { action: "audit_log_insert", alertId });
  }

  return NextResponse.json({ id: updateResult.data.id, status: updateResult.data.status });
}
