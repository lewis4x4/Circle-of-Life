/**
 * GET    /api/admin/facilities/[facilityId]  — Fetch full facility detail including entity info
 * PUT    /api/admin/facilities/[facilityId]  — Update facility core fields
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { updateFacilitySchema } from "@/lib/validation/facility-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── Helper: authenticate + get actor ──────────────────────────────

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return profile ? { ...profile, admin } : null;
}

// ── GET: Facility Detail ──────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;
  const admin = actor.admin;

  // Fetch facility with entity details
  const { data: facility, error } = await admin
    .from("facilities")
    .select(
      `id, name, phone, fax, email, address_line_1, address_line_2, city, state, zip, county,
       organization_id, administrator_name, current_administrator_id, total_licensed_beds,
       status, opening_date, care_services_offered, waitlist_count, target_occupancy_pct,
       pharmacy_vendor, last_survey_date, last_survey_result, created_at, updated_at, deleted_at`,
    )
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle() as any;

  if (error || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Fetch associated entity (registered owner/operator)
  const { data: entity } = await admin
    .from("entities")
    .select(
      "id, organization_id, entity_type, legal_name, dba_name, registered_agent_name, formation_date, sunbiz_document_number, created_at",
    )
    .eq("organization_id", actor.organization_id!)
    .maybeSingle() as any;

  return NextResponse.json({
    data: {
      ...facility,
      entity: entity || null,
    },
  });
}

// ── PUT: Update Facility ──────────────────────────────────────────

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;

  // Authorization: owner/org_admin only
  if (!["owner", "org_admin"].includes(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateFacilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const updates = parsed.data;

  const admin = actor.admin;

  // Fetch target facility
  const { data: facility, error: fetchErr } = await admin
    .from("facilities")
    .select("id, organization_id, name, phone, email, address_line_1, city, state, zip, county, status")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchErr || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) updatePayload.name = updates.name;
  if (updates.phone !== undefined) updatePayload.phone = updates.phone;
  if (updates.fax !== undefined) updatePayload.fax = updates.fax;
  if (updates.email !== undefined) updatePayload.email = updates.email;
  if (updates.address_line_1 !== undefined) updatePayload.address_line_1 = updates.address_line_1;
  if (updates.address_line_2 !== undefined) updatePayload.address_line_2 = updates.address_line_2;
  if (updates.city !== undefined) updatePayload.city = updates.city;
  if (updates.state !== undefined) updatePayload.state = updates.state;
  if (updates.zip !== undefined) updatePayload.zip = updates.zip;
  if (updates.county !== undefined) updatePayload.county = updates.county;
  if (updates.administrator_name !== undefined) updatePayload.administrator_name = updates.administrator_name;
  if (updates.current_administrator_id !== undefined)
    updatePayload.current_administrator_id = updates.current_administrator_id;
  if (updates.care_services_offered !== undefined)
    updatePayload.care_services_offered = updates.care_services_offered;
  if (updates.pharmacy_vendor !== undefined) updatePayload.pharmacy_vendor = updates.pharmacy_vendor;
  if (updates.target_occupancy_pct !== undefined)
    updatePayload.target_occupancy_pct = updates.target_occupancy_pct;
  if (updates.waitlist_count !== undefined) updatePayload.waitlist_count = updates.waitlist_count;
  if (updates.opening_date !== undefined) updatePayload.opening_date = updates.opening_date;
  if (updates.total_licensed_beds !== undefined) updatePayload.total_licensed_beds = updates.total_licensed_beds;
  if (updates.status !== undefined) updatePayload.status = updates.status;

  const { data: updated, error: updateErr } = await admin
    .from("facilities")
    .update(updatePayload as any)
    .eq("id", facilityId)
    .select()
    .single() as any;
  if (updateErr) {
    return NextResponse.json({ error: "Failed to update facility" }, { status: 500 });
  }

  return NextResponse.json({
    data: updated,
    changes: { before: facility, after: updated },
  });
}
