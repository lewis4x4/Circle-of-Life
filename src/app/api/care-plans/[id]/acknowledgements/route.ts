import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import {
  CARE_PLAN_ACK_NAME_REQUIRED_COPY,
  CARE_PLAN_ACK_ONLY_ACTIVE_COPY,
  CARE_PLAN_ACK_SIGNATURE_REQUIRED_COPY,
  isCarePlanAckMethod,
  isCarePlanAckSignerRole,
} from "@/lib/care-plans/care-plan-acknowledgement-copy";
import { logError } from "@/lib/observability/logger";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

// Same roles the table's INSERT policy names (395).
const ACK_ROLES = ["owner", "org_admin", "facility_admin", "med_tech"] as const;
const MAX_TEXT = 500;
const MAX_SIGNATURE_BYTES = 200_000;

type Body = {
  signer_role?: unknown;
  signer_name?: unknown;
  relationship_to_resident?: unknown;
  method?: unknown;
  signature_data?: unknown;
  notes?: unknown;
};

type PlanRow = {
  id: string;
  resident_id: string;
  facility_id: string;
  organization_id: string;
  status: string;
};

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * POST /api/care-plans/[id]/acknowledgements — record that the resident or a
 * representative acknowledged the signed plan. Append-only; the table has no
 * UPDATE policy, so a correction is another row.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: carePlanId } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isCarePlanAckSignerRole(body.signer_role)) {
    return NextResponse.json({ error: "signer_role must be resident, responsible_party, poa, or guardian" }, { status: 400 });
  }
  if (!isCarePlanAckMethod(body.method)) {
    return NextResponse.json({ error: "method must be in_person_signature, paper_on_file, verbal_review, or declined" }, { status: 400 });
  }
  const signerName = text(body.signer_name, 200);
  if (!signerName || signerName.length < 2) {
    return NextResponse.json({ error: CARE_PLAN_ACK_NAME_REQUIRED_COPY }, { status: 400 });
  }
  const signature = typeof body.signature_data === "string" && body.signature_data.startsWith("data:image/") ? body.signature_data : null;
  if (body.method === "in_person_signature" && !signature) {
    return NextResponse.json({ error: CARE_PLAN_ACK_SIGNATURE_REQUIRED_COPY }, { status: 400 });
  }
  if (signature && signature.length > MAX_SIGNATURE_BYTES) {
    return NextResponse.json({ error: "Signature image is too large" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({ allowedRoles: ACK_ROLES, scope: "care-plans.acknowledgements" });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const planResult = (await admin
    .from("care_plans")
    .select("id, resident_id, facility_id, organization_id, status")
    .eq("id", carePlanId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as { data: PlanRow | null; error: { message: string } | null };
  if (planResult.error || !planResult.data) {
    return NextResponse.json({ error: "Care plan not found" }, { status: 404 });
  }
  const plan = planResult.data;

  const hasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: plan.facility_id,
    organizationId: actor.organizationId,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "You do not have access to this care plan" }, { status: 403 });
  }
  if (plan.status !== "active") {
    return NextResponse.json({ error: CARE_PLAN_ACK_ONLY_ACTIVE_COPY }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const insertResult = (await admin
    .from("care_plan_acknowledgements")
    .insert({
      organization_id: plan.organization_id,
      facility_id: plan.facility_id,
      care_plan_id: plan.id,
      resident_id: plan.resident_id,
      signer_role: body.signer_role,
      signer_name: signerName,
      relationship_to_resident: text(body.relationship_to_resident, 120),
      method: body.method,
      signature_data: body.method === "in_person_signature" ? signature : null,
      acknowledged_at: nowIso,
      recorded_by: actor.id,
      notes: text(body.notes),
    })
    .select("id, signer_role, signer_name, relationship_to_resident, method, acknowledged_at")
    .maybeSingle()) as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (insertResult.error || !insertResult.data) {
    logError("care-plans.acknowledgements", insertResult.error ?? new Error("insert returned no row"), { action: "insert", carePlanId });
    return NextResponse.json({ error: "Acknowledgement could not be recorded" }, { status: 500 });
  }

  return NextResponse.json(insertResult.data, { status: 201 });
}
