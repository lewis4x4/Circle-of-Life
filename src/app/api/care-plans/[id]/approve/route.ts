import { NextResponse } from "next/server";
import { logError } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

type Body = {
  signature: string;
};

const APPROVEABLE_STATUSES = new Set(["draft", "under_review"]);
const APPROVER_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

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

  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logError("care-plans.approve", e, { action: "service_role_client" });
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 503 }
    );
  }

  // Fetch the care plan and verify user access
  const { data: carePlan, error: planError } = await admin
    .from("care_plans")
    .select(
      "id, resident_id, facility_id, organization_id, status, version, effective_date"
    )
    .eq("id", carePlanId)
    .is("deleted_at", null)
    .maybeSingle();

  if (planError || !carePlan) {
    return NextResponse.json(
      { error: "Care plan not found" },
      { status: 404 }
    );
  }

  // Verify user has facility access
  const { data: userProfile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, app_role, full_name")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError || !userProfile) {
    return NextResponse.json(
      { error: "User profile not found" },
      { status: 403 }
    );
  }

  if (!userProfile.organization_id) {
    return NextResponse.json(
      { error: "User profile missing organization" },
      { status: 403 }
    );
  }

  if (!APPROVER_ROLES.has(userProfile.app_role ?? "")) {
    return NextResponse.json(
      { error: "You do not have permission to approve care plans" },
      { status: 403 }
    );
  }

  if (carePlan.organization_id !== userProfile.organization_id) {
    return NextResponse.json(
      { error: "Care plan organization mismatch" },
      { status: 403 }
    );
  }

  const hasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: user.id,
    facilityId: carePlan.facility_id,
    organizationId: userProfile.organization_id,
    appRole: userProfile.app_role,
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

  // Approve the care plan
  const nowIso = new Date().toISOString();
  const { data: updatedCarePlan, error: updateError } = await admin
    .from("care_plans")
    .update({
      status: "active",
      approved_at: nowIso,
      approved_by: user.id,
      signature_data: signature,
      updated_at: nowIso,
      updated_by: user.id,
    })
    .eq("id", carePlanId)
    .eq("organization_id", userProfile.organization_id)
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
    user_id: user.id,
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
      id: user.id,
      name: formatUploadedByProfile({
        full_name: userProfile.full_name,
        email: user.email,
      }),
    },
  });
}
