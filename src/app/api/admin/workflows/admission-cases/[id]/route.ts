import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import {
  convertLeadOnMoveIn,
  emitWorkflowEvent,
  loadAdmissionCaseWorkflowContext,
  loadAdmissionRateTermCount,
  loadForm1823State,
} from "@/lib/workflows/workflow-events";
import type { Database } from "@/types/database";

const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
] as const;

type AdmissionPatch = Partial<Database["public"]["Tables"]["admission_cases"]["Update"]>;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorResult = await requireAdminApiActor({ allowedRoles: ALLOWED_ROLES });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const { id } = await params;

  let patch: AdmissionPatch;
  try {
    patch = (await request.json()) as AdmissionPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = await loadAdmissionCaseWorkflowContext(actor.admin, id);
  if (!current) {
    return NextResponse.json({ error: "Admission case not found" }, { status: 404 });
  }

  const canAccessFacility = await actorCanAccessFacility(actor, current.facility_id);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  const nextStatus = patch.status ?? current.status;
  const nextBedId = patch.bed_id === undefined ? current.bed_id : patch.bed_id;
  const nextTargetMoveInDate = patch.target_move_in_date === undefined ? current.target_move_in_date : patch.target_move_in_date;
  const nextFinancialClearance = patch.financial_clearance_at === undefined ? current.financial_clearance_at : patch.financial_clearance_at;
  const nextPhysicianOrders = patch.physician_orders_received_at === undefined ? current.physician_orders_received_at : patch.physician_orders_received_at;

  if (nextStatus === "bed_reserved" && (!nextFinancialClearance || !nextPhysicianOrders || !nextBedId)) {
    return NextResponse.json({
      error: "Bed reserved requires financial clearance, physician orders, and a bed assignment.",
    }, { status: 409 });
  }

  if (nextStatus === "move_in") {
    const rateTermCount = await loadAdmissionRateTermCount(actor.admin, current.id);
    const form1823State = await loadForm1823State(actor.admin, {
      admissionCaseId: current.id,
      residentId: current.resident_id,
    });
    const blockedBy = [
      !nextFinancialClearance ? "financial clearance" : null,
      !nextPhysicianOrders ? "physician orders" : null,
      !nextBedId ? "bed assignment" : null,
      !nextTargetMoveInDate ? "target move-in date" : null,
      rateTermCount === 0 ? "quoted rate terms" : null,
      !form1823State.isSatisfied ? "Form 1823" : null,
    ].filter(Boolean);

    if (blockedBy.length > 0) {
      await emitWorkflowEvent(actor.admin, {
        organization_id: current.organization_id,
        facility_id: current.facility_id,
        admission_case_id: current.id,
        referral_lead_id: current.referral_lead_id,
        resident_id: current.resident_id,
        event_type: "admission_move_in_blocked",
        source_module: "admissions",
        created_by: actor.id,
        payload_json: {
          blocked_by: blockedBy,
        },
      });

      return NextResponse.json({
        error: `Move-in blocked: ${blockedBy.join(", ")}.`,
        blocked_by: blockedBy,
      }, { status: 409 });
    }
  }

  const updatePayload = {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by: actor.id,
  };

  const { error: updateError } = await actor.admin
    .from("admission_cases")
    .update(updatePayload)
    .eq("id", current.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (patch.status && patch.status !== current.status) {
    await emitWorkflowEvent(actor.admin, {
      organization_id: current.organization_id,
      facility_id: current.facility_id,
      admission_case_id: current.id,
      referral_lead_id: current.referral_lead_id,
      resident_id: current.resident_id,
      event_type: "admission_status_changed",
      source_module: "admissions",
      event_key: `admission-status:${current.id}:${patch.status}`,
      created_by: actor.id,
      payload_json: {
        from_status: current.status,
        to_status: patch.status,
      },
    });

    if (patch.status === "move_in" && current.referral_lead_id) {
      await convertLeadOnMoveIn(actor.admin, {
        leadId: current.referral_lead_id,
        residentId: current.resident_id,
        actorId: actor.id,
      });

      await emitWorkflowEvent(actor.admin, {
        organization_id: current.organization_id,
        facility_id: current.facility_id,
        admission_case_id: current.id,
        referral_lead_id: current.referral_lead_id,
        resident_id: current.resident_id,
        event_type: "referral_converted",
        source_module: "admissions",
        event_key: `referral-converted:${current.id}:${current.referral_lead_id}`,
        created_by: actor.id,
        payload_json: {
          converted_resident_id: current.resident_id,
        },
      });
    }
  } else {
    await emitWorkflowEvent(actor.admin, {
      organization_id: current.organization_id,
      facility_id: current.facility_id,
      admission_case_id: current.id,
      referral_lead_id: current.referral_lead_id,
      resident_id: current.resident_id,
      event_type: "admission_case_updated",
      source_module: "admissions",
      created_by: actor.id,
      payload_json: {
        fields: Object.keys(patch),
      },
    });
  }

  return NextResponse.json({ success: true });
}
