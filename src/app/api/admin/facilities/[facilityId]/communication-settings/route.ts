/**
 * GET    /api/admin/facilities/[facilityId]/communication-settings  — Fetch communication settings (1:1 with facility)
 * PUT    /api/admin/facilities/[facilityId]/communication-settings  — Upsert communication settings
 *
 * Authorization: facility_admin can only update visitation/notification fields.
 *                owner/org_admin can update all fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { communicationSettingsSchema } from "@/lib/validation/facility-admin";

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

// ── GET: Fetch Communication Settings ──────────────────────────────

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

  // Fetch communication settings
  const { data: settings, error } = await admin
    .from("facility_communication_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle() as any;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch communication settings" }, { status: 500 });
  }

  return NextResponse.json({
    data: settings,
  });
}

// ── PUT: Upsert Communication Settings ─────────────────────────────

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { facilityId } = await ctx.params;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = communicationSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  let updates = parsed.data;

  // Authorization: facility_admin can only update visitation/notification fields
  if (actor.app_role === "facility_admin") {
    // Allowed fields for facility_admin
    const allowedFields = [
      "visiting_hours_start",
      "visiting_hours_end",
      "visitor_check_in_required",
      "visitor_screening_enabled",
      "restricted_areas",
      "auto_notify_incident_types",
      "care_plan_update_notifications",
      "photo_sharing_enabled",
      "message_approval_required",
    ];

    // Filter updates to only allowed fields
    const filteredUpdates: Record<string, any> = {};
    for (const key of allowedFields) {
      if (key in updates) {
        filteredUpdates[key] = (updates as any)[key];
      }
    }
    updates = filteredUpdates as any;
  } else if (!["owner", "org_admin"].includes(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

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
    // Fetch existing settings
    const { data: existing } = await admin
      .from("facility_communication_settings")
      .select("id")
      .eq("facility_id", facilityId)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      const { data: updated, error: updateErr } = await admin
        .from("facility_communication_settings")
        .update({
          ...updates,
          updated_at: now,
          updated_by: actor.id,
        } as any)
        .eq("facility_id", facilityId)
        .select()
        .single() as any;

      if (updateErr) {
        return NextResponse.json(
          { error: "Failed to update communication settings" },
          { status: 500 },
        );
      }

      return NextResponse.json({ data: updated });
    } else {
      // Create new
      const { data: created, error: insertErr } = await admin
        .from("facility_communication_settings")
        .insert({
          facility_id: facilityId,
          organization_id: actor.organization_id!,
          ...updates,
          created_by: actor.id,
          updated_by: actor.id,
        } as any)
        .select()
        .single() as any;

      if (insertErr) {
        return NextResponse.json(
          { error: "Failed to create communication settings" },
          { status: 500 },
        );
      }

      return NextResponse.json({ data: created }, { status: 201 });
    }
  } catch (err) {
    console.error("[communication-settings-upsert] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
