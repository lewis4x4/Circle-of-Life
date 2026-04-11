/**
 * GET    /api/admin/facilities/[facilityId]/building-profile  — Fetch building profile (1:1 with facility)
 * PUT    /api/admin/facilities/[facilityId]/building-profile  — Upsert building profile
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildingProfileSchema } from "@/lib/validation/facility-admin";

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

// ── GET: Fetch Building Profile ───────────────────────────────────

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

  // Fetch building profile
  const { data: profile, error } = await admin
    .from("facility_building_profiles")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch building profile" }, { status: 500 });
  }

  return NextResponse.json({
    data: profile,
  });
}

// ── PUT: Upsert Building Profile ──────────────────────────────────

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

  const parsed = buildingProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const updates = parsed.data;

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
    // Fetch existing profile
    const { data: existing } = await admin
      .from("facility_building_profiles")
      .select("id")
      .eq("facility_id", facilityId)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      const { data: updated, error: updateErr } = await admin
        .from("facility_building_profiles")
        .update({
          ...updates,
          updated_at: now,
          updated_by: actor.id,
        } as Record<string, unknown>)
        .eq("facility_id", facilityId)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: "Failed to update building profile" }, { status: 500 });
      }

      return NextResponse.json({ data: updated });
    } else {
      // Create new
      const { data: created, error: insertErr } = await admin
        .from("facility_building_profiles")
        .insert({
          facility_id: facilityId,
          organization_id: actor.organization_id!,
          ...updates,
          created_by: actor.id,
          updated_by: actor.id,
        } as Record<string, unknown>)
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json({ error: "Failed to create building profile" }, { status: 500 });
      }

      return NextResponse.json({ data: created }, { status: 201 });
    }
  } catch (err) {
    console.error("[building-profile-upsert] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
