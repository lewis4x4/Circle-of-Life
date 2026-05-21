/**
 * GET    /api/admin/facilities/[facilityId]/thresholds  — List thresholds for facility
 * PUT    /api/admin/facilities/[facilityId]/thresholds  — Bulk upsert thresholds (array)
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { thresholdSchema } from "@/lib/validation/facility-admin";
import { z } from "zod";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { logError } from "@/lib/observability/logger";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── GET: List Thresholds ──────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

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
  const { data: thresholdsRaw, error } = await untypedAdmin
    .from("facility_operational_thresholds")
    .select(
      "id, threshold_type, yellow_threshold, red_threshold, notify_roles, enabled, alert_frequency, created_at, updated_at, updated_by",
    )
    .eq("facility_id", facilityId);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch thresholds" }, { status: 500 });
  }

  const { data: orgDefaultsRaw, error: orgErr } = await untypedAdmin
    .from("organization_operational_threshold_defaults")
    .select("threshold_type, yellow_threshold, red_threshold, notify_roles, alert_frequency")
    .eq("organization_id", facility.organization_id);

  if (orgErr) {
    return NextResponse.json({ error: "Failed to fetch organization threshold defaults" }, { status: 500 });
  }

  const updaterIds = [...new Set((thresholdsRaw ?? []).map((r: { updated_by?: string | null }) => r.updated_by).filter(Boolean))] as string[];
  const labelMap = new Map<string, string>();
  if (updaterIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("id, full_name")
      .in("id", updaterIds);
    for (const p of profiles ?? []) {
      const row = p as { id: string; full_name: string | null };
      if (row.full_name?.trim()) labelMap.set(row.id, row.full_name.trim());
      else labelMap.set(row.id, row.id.slice(0, 8));
    }
  }

  const data = (thresholdsRaw ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    updated_by_display: r.updated_by ? (labelMap.get(String(r.updated_by)) ?? null) : null,
  }));

  return NextResponse.json({
    data,
    org_defaults: orgDefaultsRaw ?? [],
  });
}

// ── PUT: Bulk Upsert Thresholds ───────────────────────────────────

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
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
    const rpcAdmin = admin as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    const { data, error } = await rpcAdmin.rpc("upsert_facility_operational_thresholds", {
      p_facility_id: facilityId,
      p_organization_id: actor.organization_id!,
      p_actor_id: actor.id,
      p_thresholds: thresholds,
    });

    if (error) {
      return NextResponse.json({ error: "Failed to save thresholds" }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logError("admin.facilities.thresholds.upsert", err, {
      facilityId,
      thresholdCount: thresholds.length,
    });
    return NextResponse.json({ error: "Failed to save thresholds" }, { status: 500 });
  }
}
