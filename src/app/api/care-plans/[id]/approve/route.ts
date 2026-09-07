import { NextResponse } from "next/server";
import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

type Body = {
  signature: string;
};

const APPROVEABLE_STATUSES = new Set(["draft", "under_review"]);
const APPROVER_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: carePlanId } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { signature } = body;

  if (!signature) {
    return NextResponse.json(
      { error: "Signature is required" },
      { status: 400 }
    );
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: APPROVER_ROLES,
    scope: "care-plans.approve",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  // Fetch the care plan and verify user access
  const { data: carePlan, error: planError } = await admin
    .from("care_plans")
    .select(
      "id, resident_id, facility_id, organization_id, status, version, effective_date"
    )
    .eq("id", carePlanId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (planError || !carePlan) {
    return NextResponse.json(
      { error: "Care plan not found" },
      { status: 404 }
    );
  }

  const hasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: carePlan.facility_id,
    organizationId: actor.organizationId,
  });

  if (!hasAccess) {
    return NextResponse.json(
      { error: "You do not have access to this care plan" },
      { status: 403 }
    );
  }

  // Verify care plan status allows approval
  if (!APPROVEABLE_STATUSES.has(carePlan.status)) {
    return NextResponse.json(
      { error: `Care plan status '${carePlan.status}' cannot be approved` },
      { status: 400 }
    );
  }

  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: APPROVER_ROLES,
    scope: "care-plans.approve.revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (currentActor.organizationId !== carePlan.organization_id) {
    return NextResponse.json({ error: "Care plan not found" }, { status: 404 });
  }
  const stillHasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: currentActor.id,
    facilityId: carePlan.facility_id,
    organizationId: currentActor.organizationId,
  });
  if (!stillHasAccess) {
    return NextResponse.json({ error: "You do not have access to this care plan" }, { status: 403 });
  }

  // Approve the care plan
  const nowIso = new Date().toISOString();
  const { data: updatedCarePlan, error: updateError } = await admin
    .from("care_plans")
    .update({
      status: "active",
      approved_at: nowIso,
      approved_by: currentActor.id,
      signature_data: signature,
      updated_at: nowIso,
      updated_by: currentActor.id,
    })
    .eq("id", carePlanId)
    .eq("organization_id", currentActor.organizationId)
    .eq("facility_id", carePlan.facility_id)
    .eq("status", carePlan.status)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    logError("care-plans.approve", updateError, { action: "update_care_plan", carePlanId });
    return NextResponse.json(
      { error: "Failed to approve care plan" },
      { status: 500 }
    );
  }

  if (!updatedCarePlan) {
    return NextResponse.json(
      { error: "Care plan state changed; refresh and try again" },
      { status: 409 }
    );
  }

  // Audit logging
  const { error: auditError } = await admin.from("audit_log").insert({
    table_name: "care_plans",
    record_id: carePlanId,
    action: "UPDATE",
    new_data: {
      event: "care_plan_approved",
      previous_status: carePlan.status,
      new_status: "active",
      version: carePlan.version,
      resident_id: carePlan.resident_id,
    },
    user_id: currentActor.id,
    organization_id: carePlan.organization_id,
    facility_id: carePlan.facility_id,
  });

  if (auditError) {
    logError("care-plans.approve", auditError, { action: "audit_log_insert", carePlanId });
  }

  return NextResponse.json({
    success: true,
    carePlanId,
    approvedAt: nowIso,
    approvedBy: {
      id: currentActor.id,
      name: formatUploadedByProfile({
        full_name: currentActor.fullName,
        email: currentActor.sessionEmail ?? currentActor.email ?? undefined,
      }),
    },
  });
}
