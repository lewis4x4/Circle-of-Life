import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { ensureForm1823Checklist, emitWorkflowEvent, syncLeadToApplicationPending } from "@/lib/workflows/workflow-events";

const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
] as const;

type RequestBody = {
  facility_id?: string;
  resident_id?: string;
  referral_lead_id?: string | null;
  bed_id?: string | null;
  target_move_in_date?: string | null;
  notes?: string | null;
};

export async function POST(request: NextRequest) {
  const actorResult = await requireAdminApiActor({ allowedRoles: ALLOWED_ROLES });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.facility_id || !body.resident_id) {
    return NextResponse.json({ error: "facility_id and resident_id are required" }, { status: 400 });
  }

  const canAccessFacility = await actorCanAccessFacility(actor, body.facility_id);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await actor.admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", body.facility_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility?.organization_id) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data: resident, error: residentError } = await actor.admin
    .from("residents")
    .select("id, facility_id")
    .eq("id", body.resident_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (residentError || !resident || resident.facility_id !== body.facility_id) {
    return NextResponse.json({ error: "Resident not found in facility" }, { status: 400 });
  }

  if (body.referral_lead_id) {
    const { data: lead, error: leadError } = await actor.admin
      .from("referral_leads")
      .select("id, facility_id")
      .eq("id", body.referral_lead_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (leadError || !lead || lead.facility_id !== body.facility_id) {
      return NextResponse.json({ error: "Referral lead not found in facility" }, { status: 400 });
    }
  }

  const { data: inserted, error: insertError } = await actor.admin
    .from("admission_cases")
    .insert({
      organization_id: facility.organization_id,
      facility_id: body.facility_id,
      resident_id: body.resident_id,
      referral_lead_id: body.referral_lead_id ?? null,
      bed_id: body.bed_id ?? null,
      target_move_in_date: body.target_move_in_date ?? null,
      notes: body.notes ?? null,
      status: "pending_clearance",
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("id, organization_id, facility_id, resident_id, referral_lead_id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create admission case" }, { status: 500 });
  }

  await ensureForm1823Checklist(actor.admin, {
    organizationId: inserted.organization_id,
    facilityId: inserted.facility_id,
    admissionCaseId: inserted.id,
    actorId: actor.id,
  });

  if (inserted.referral_lead_id) {
    await syncLeadToApplicationPending(actor.admin, {
      leadId: inserted.referral_lead_id,
      actorId: actor.id,
    });

    await emitWorkflowEvent(actor.admin, {
      organization_id: inserted.organization_id,
      facility_id: inserted.facility_id,
      referral_lead_id: inserted.referral_lead_id,
      admission_case_id: inserted.id,
      resident_id: inserted.resident_id,
      event_type: "referral_admission_started",
      source_module: "admissions",
      event_key: `referral-admission-started:${inserted.id}`,
      created_by: actor.id,
      payload_json: {
        status: "pending_clearance",
        target_move_in_date: body.target_move_in_date ?? null,
        bed_id: body.bed_id ?? null,
      },
    });
  }

  return NextResponse.json({ id: inserted.id });
}
