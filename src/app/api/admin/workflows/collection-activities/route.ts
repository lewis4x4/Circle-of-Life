import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { emitWorkflowEvent } from "@/lib/workflows/workflow-events";

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
  resident_id?: string;
  facility_id?: string;
  invoice_id?: string | null;
  activity_type?: string;
  activity_date?: string;
  description?: string;
  outcome?: string | null;
  follow_up_date?: string | null;
  follow_up_notes?: string | null;
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

  if (!body.resident_id || !body.facility_id || !body.activity_type || !body.activity_date || !body.description) {
    return NextResponse.json({ error: "resident_id, facility_id, activity_type, activity_date, and description are required" }, { status: 400 });
  }

  const canAccessFacility = await actorCanAccessFacility(actor, body.facility_id);
  if (!canAccessFacility) {
    return NextResponse.json({ error: "Access denied for facility" }, { status: 403 });
  }

  const { data: resident, error: residentError } = await actor.admin
    .from("residents")
    .select("id, organization_id, facility_id")
    .eq("id", body.resident_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (residentError || !resident || resident.facility_id !== body.facility_id) {
    return NextResponse.json({ error: "Resident not found in facility" }, { status: 400 });
  }

  const { data: insertedData, error: insertError } = await actor.admin
    .from("collection_activities")
    .insert({
      resident_id: body.resident_id,
      invoice_id: body.invoice_id ?? null,
      facility_id: body.facility_id,
      organization_id: resident.organization_id,
      activity_type: body.activity_type,
      activity_date: body.activity_date,
      performed_by: actor.id,
      description: body.description,
      outcome: body.outcome ?? null,
      follow_up_date: body.follow_up_date ?? null,
      follow_up_notes: body.follow_up_notes ?? null,
    })
    .select("id")
    .single();

  const inserted = insertedData as { id: string } | null;

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create collection activity" }, { status: 500 });
  }

  await emitWorkflowEvent(actor.admin, {
    organization_id: resident.organization_id,
    facility_id: body.facility_id,
    resident_id: body.resident_id,
    invoice_id: body.invoice_id ?? null,
    collection_activity_id: inserted.id,
    event_type: "collection_activity_logged",
    source_module: "billing",
    event_key: `collection-activity:${inserted.id}`,
    created_by: actor.id,
    payload_json: {
      activity_type: body.activity_type,
      activity_date: body.activity_date,
      outcome: body.outcome ?? null,
      follow_up_date: body.follow_up_date ?? null,
    },
  });

  return NextResponse.json({ id: inserted.id });
}
