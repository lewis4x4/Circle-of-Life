import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import {
  emitWorkflowEvent,
  loadAdmissionCaseWorkflowContext,
  upsertAdmissionForm1823,
} from "@/lib/workflows/workflow-events";

const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "coordinator",
  "nurse",
] as const;

type RequestBody = {
  status?: "pending" | "received" | "expired" | "renewal_due";
  physician_name?: string | null;
  exam_date?: string | null;
  expiration_date?: string | null;
  notes?: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorResult = await requireAdminApiActor({ allowedRoles: ALLOWED_ROLES });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const { id } = await params;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const current = await loadAdmissionCaseWorkflowContext(actor.admin, id);
  if (!current) {
    return NextResponse.json({ error: "Admission case not found" }, { status: 404 });
  }

  const canAccessFacility = await actorCanAccessFacility(actor, current.facility_id);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  const state = await upsertAdmissionForm1823(actor.admin, {
    organizationId: current.organization_id,
    facilityId: current.facility_id,
    admissionCaseId: current.id,
    residentId: current.resident_id,
    actorId: actor.id,
    status: body.status,
    physicianName: body.physician_name ?? null,
    examDate: body.exam_date ?? null,
    expirationDate: body.expiration_date ?? null,
    notes: body.notes ?? null,
  });

  if (body.status === "received") {
    await emitWorkflowEvent(actor.admin, {
      organization_id: current.organization_id,
      facility_id: current.facility_id,
      admission_case_id: current.id,
      referral_lead_id: current.referral_lead_id,
      resident_id: current.resident_id,
      event_type: "form_1823_received",
      source_module: "admissions",
      event_key: `form-1823-received:${current.id}`,
      created_by: actor.id,
      payload_json: {
        status: body.status,
        exam_date: body.exam_date ?? null,
        expiration_date: body.expiration_date ?? null,
      },
    });
  }

  return NextResponse.json(state);
}
