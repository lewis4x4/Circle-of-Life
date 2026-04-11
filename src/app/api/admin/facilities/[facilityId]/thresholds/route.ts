/**
 * GET    /api/admin/facilities/[facilityId]/thresholds  — List thresholds for facility
 * PUT    /api/admin/facilities/[facilityId]/thresholds  — Bulk upsert thresholds (array)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { thresholdSchema } from "@/lib/validation/facility-admin";
import { z } from "zod";

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

// ── GET: List Thresholds ──────────────────────────────────────────

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

  // List thresholds
  const { data: thresholds, error } = await (admin as any)
    .from("facility_operational_thresholds")
    .select("id, threshold_type, yellow_threshold, red_threshold, notify_roles, enabled, created_at, updated_at")
    .eq("facility_id", facilityId);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch thresholds" }, { status: 500 });
  }

  return NextResponse.json({
    data: thresholds ?? [],
  });
}

// ── PUT: Bulk Upsert Thresholds ───────────────────────────────────

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

  // Validate array of thresholds
  const thresholdArraySchema = z.array(
    thresholdSchema.extend({
      id: z.string().uuid().optional(),
    }),
  );

  const parsed = thresholdArraySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const thresholds = parsed.data;

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
    const now = new Date().toISOString();
    const results: unknown[] = [];

    for (const threshold of thresholds) {
      if (threshold.id) {
        // Update existing
        const { data: updated, error: updateErr } = await (admin as any)
          .from("facility_operational_thresholds")
          .update({
            yellow_threshold: threshold.yellow_threshold,
            red_threshold: threshold.red_threshold,
            notify_roles: threshold.notify_roles,
            enabled: threshold.enabled,
            updated_at: now,
            updated_by: actor.id,
          } as Record<string, unknown>)
          .eq("id", threshold.id)
          .eq("facility_id", facilityId)
          .select()
          .single();

        if (updateErr) {
          return NextResponse.json(
            { error: `Failed to update threshold ${threshold.id}` },
            { status: 500 },
          );
        }
        results.push(updated);
      } else {
        // Create new (upsert by threshold_type)
        const { data: existing } = await (admin as any)
          .from("facility_operational_thresholds")
          .select("id")
          .eq("facility_id", facilityId)
          .eq("threshold_type", threshold.threshold_type)
          .maybeSingle();

        if (existing) {
          // Update existing by type
          const { data: updated, error: updateErr } = await (admin as any)
            .from("facility_operational_thresholds")
            .update({
              yellow_threshold: threshold.yellow_threshold,
              red_threshold: threshold.red_threshold,
              notify_roles: threshold.notify_roles,
              enabled: threshold.enabled,
              updated_at: now,
              updated_by: actor.id,
            } as Record<string, unknown>)
            .eq("id", existing.id)
            .select()
            .single();

          if (updateErr) {
            return NextResponse.json(
              { error: `Failed to update threshold ${threshold.threshold_type}` },
              { status: 500 },
            );
          }
          results.push(updated);
        } else {
          // Create new
          const { data: created, error: insertErr } = await (admin as any)
            .from("facility_operational_thresholds")
            .insert({
              facility_id: facilityId,
              organization_id: actor.organization_id!,
              threshold_type: threshold.threshold_type,
              yellow_threshold: threshold.yellow_threshold,
              red_threshold: threshold.red_threshold,
              notify_roles: threshold.notify_roles,
              enabled: threshold.enabled,
              created_by: actor.id,
              updated_by: actor.id,
            } as Record<string, unknown>)
            .select()
            .single();

          if (insertErr) {
            return NextResponse.json(
              { error: `Failed to create threshold ${threshold.threshold_type}` },
              { status: 500 },
            );
          }
          results.push(created);
        }
      }
    }

    return NextResponse.json({
      data: results,
    });
  } catch (err) {
    console.error("[thresholds-upsert] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
