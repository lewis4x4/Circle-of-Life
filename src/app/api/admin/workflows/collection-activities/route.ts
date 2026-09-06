import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

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
  id?: string;
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

  if (body.id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) return NextResponse.json({ error: "Invalid activity identity" }, { status: 400 });
    const { data: existing, error: existingError } = await actor.admin.from("collection_activities").select("*").eq("id", body.id).maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    if (existing) {
      if (existing.performed_by !== actor.id || existing.facility_id !== body.facility_id || existing.resident_id !== body.resident_id || existing.description !== body.description || existing.activity_type !== body.activity_type || existing.activity_date !== body.activity_date || existing.invoice_id !== (body.invoice_id ?? null) || existing.outcome !== (body.outcome ?? null) || existing.follow_up_date !== (body.follow_up_date ?? null) || existing.follow_up_notes !== (body.follow_up_notes ?? null)) return NextResponse.json({ error: "This activity identity was already saved with different values. Review the saved activity." }, { status: 409 });
      return NextResponse.json({ id: existing.id });
    }
  }

  const { data: insertedData, error: insertError } = await actor.admin
    .from("collection_activities")
    .insert({
      ...(body.id ? { id: body.id } : {}),
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

  return NextResponse.json({ id: inserted.id });
}
