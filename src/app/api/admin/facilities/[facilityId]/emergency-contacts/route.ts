/**
 * GET    /api/admin/facilities/[facilityId]/emergency-contacts  — List emergency contacts
 * POST   /api/admin/facilities/[facilityId]/emergency-contacts  — Create emergency contact
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { emergencyContactSchema } from "@/lib/validation/facility-admin";

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

// ── GET: List Emergency Contacts ──────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;
  const admin = actor.admin;

  // Verify facility exists and belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // List contacts ordered by sort_order
  const { data: contacts, error } = await admin
    .from("facility_emergency_contacts")
    .select(
      "id, contact_category, contact_name, phone_primary, phone_secondary, address, distance_miles, drive_time_minutes, account_number, notes, sort_order, created_at, updated_at",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 });
  }

  return NextResponse.json({
    data: contacts ?? [],
  });
}

// ── POST: Create Emergency Contact ────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
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

  const parsed = emergencyContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const admin = actor.admin;

  // Verify facility exists and belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  try {
    // Create contact
    const { data: contact, error: insertErr } = await admin
      .from("facility_emergency_contacts")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        contact_category: data.contact_category,
        contact_name: data.contact_name,
        phone_primary: data.phone_primary,
        phone_secondary: data.phone_secondary ?? null,
        address: data.address ?? null,
        distance_miles: data.distance_miles ?? null,
        drive_time_minutes: data.drive_time_minutes ?? null,
        account_number: data.account_number ?? null,
        notes: data.notes ?? null,
        sort_order: data.sort_order,
        created_by: actor.id,
      } as any)
      .select()
      .single() as any;

    if (insertErr) {
      return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
    }

    return NextResponse.json({ data: contact }, { status: 201 });
  } catch (err) {
    console.error("[contact-create] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
