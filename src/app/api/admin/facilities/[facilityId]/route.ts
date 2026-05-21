/**
 * GET    /api/admin/facilities/[facilityId]  — Fetch full facility detail including entity info
 * PUT    /api/admin/facilities/[facilityId]  — Update facility core fields
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { updateFacilitySchema } from "@/lib/validation/facility-admin";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { pickSurveyReadinessPct } from "@/lib/admin/facilities/portfolio-metrics";
import { logError } from "@/lib/observability/logger";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── GET: Facility Detail ──────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) {
    return auth.response;
  }
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

  if (!actor.organization_id) {
    return NextResponse.json({ error: "Profile has no organization context" }, { status: 403 });
  }
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Select * keeps this route tolerant of schema drift (optional migration 131+ columns).
  const { data: facility, error } = await admin
    .from("facilities")
    .select("*")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    logError("admin.facilities.detail.get", error, {
      facilityId,
    });
    return NextResponse.json({ error: error.message || "Database error loading facility" }, { status: 500 });
  }
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const fac = facility as Record<string, unknown> & {
    entity_id?: string | null;
    total_licensed_beds?: number;
    license_number?: string | null;
    ahca_license_number?: string | null;
    license_expiration?: string | null;
    ahca_license_expiration?: string | null;
  };

  // Associated entity (must match facility.entity_id, not org-wide first row)
  let entity: Record<string, unknown> | null = null;
  if (fac.entity_id) {
    const { data: ent } = await admin
      .from("entities")
      .select(
        "id, organization_id, entity_type, legal_name, dba_name, registered_agent_name, formation_date, sunbiz_document_number, created_at",
      )
      .eq("id", fac.entity_id)
      .eq("organization_id", actor.organization_id)
      .maybeSingle();
    entity = (ent ?? null) as Record<string, unknown> | null;
  }

  // Bed census for header / overview
  const { data: beds } = await untypedAdmin
    .from("beds")
    .select("current_resident_id")
    .eq("facility_id", facilityId);

  const typedBeds = (beds ?? []) as unknown as Array<{ current_resident_id: string | null }>;
  let occupancy_count = 0;
  const total_beds = typedBeds.length;
  for (const b of typedBeds) {
    if (b.current_resident_id) occupancy_count++;
  }

  let portfolio_open_incidents_total = 0;
  let portfolio_open_incidents_level_3 = 0;
  let survey_readiness_pct: number | null = null;

  const orgId = actor.organization_id!;
  const [incRes, riskLatestRes, deficienciesOpenCountRes] = await Promise.all([
    untypedAdmin
      .from("incidents")
      .select("status, severity")
      .eq("organization_id", orgId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null),
    untypedAdmin
      .from("risk_score_snapshots")
      .select("summary_json")
      .eq("organization_id", orgId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("computed_at", { ascending: false })
      .limit(1),
    untypedAdmin
      .from("survey_deficiencies")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("status", "in", "(corrected,verified)"),
  ]);

  const incRows =
    (((incRes as { data?: unknown }).data ?? []) as unknown as Array<{ status: string; severity: string }>) ?? [];

  for (const inc of incRows) {
    if (inc.status === "closed" || inc.status === "resolved") continue;
    portfolio_open_incidents_total += 1;
    if (inc.severity === "level_3") portfolio_open_incidents_level_3 += 1;
  }

  const riskLatestArray =
    (((riskLatestRes as { data?: unknown }).data ?? []) as unknown as Array<{ summary_json: unknown }>) ?? [];
  const latestRisk = riskLatestArray[0] ?? null;
  if (latestRisk) survey_readiness_pct = pickSurveyReadinessPct(latestRisk.summary_json);

  const defCountRaw = (deficienciesOpenCountRes as { count?: number | null }).count;
  const open_survey_deficiencies_count =
    typeof defCountRaw === "number" && Number.isFinite(defCountRaw) ? defCountRaw : 0;

  let profile_last_saved_by_full_name: string | null = null;
  const ub = (fac as { updated_by?: string | null }).updated_by;
  const touchUid = typeof ub === "string" ? ub.trim() : "";
  if (touchUid.length > 0) {
    const { data: touchProfile } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("id", touchUid)
      .is("deleted_at", null)
      .maybeSingle();
    const fn = typeof touchProfile?.full_name === "string" ? touchProfile.full_name.trim() : "";
    profile_last_saved_by_full_name = fn.length > 0 ? fn : null;
  }

  const entityName =
    (entity?.legal_name as string | undefined) ??
    (entity?.dba_name as string | undefined) ??
    null;

  return NextResponse.json({
    data: {
      ...fac,
      entity: entity ?? null,
      entity_name: entityName,
      occupancy_count,
      total_beds,
      current_occupancy: occupancy_count,
      licensed_beds: fac.total_licensed_beds ?? 0,
      ahca_license_number: fac.license_number ?? fac.ahca_license_number ?? null,
      ahca_license_expiration: fac.license_expiration ?? fac.ahca_license_expiration ?? null,
      portfolio_open_incidents_total,
      portfolio_open_incidents_level_3,
      survey_readiness_pct,
      labor_cost_mtd_pct: null as number | null,
      open_survey_deficiencies_count,
      profile_last_saved_by_full_name,
    },
  });
}

// ── PUT: Update Facility ──────────────────────────────────────────

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) {
    return auth.response;
  }
  const { actor } = auth;

  const { facilityId } = await ctx.params;

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
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: actor.id,
  };
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
  if (updates.alf_license_type !== undefined) updatePayload.alf_license_type = updates.alf_license_type;

  const { data: updated, error: updateErr } = await admin
    .from("facilities")
    .update(updatePayload as Record<string, unknown>)
    .eq("id", facilityId)
    .select()
    .single();
  if (updateErr) {
    return NextResponse.json({ error: "Failed to update facility" }, { status: 500 });
  }

  return NextResponse.json({
    data: updated,
    changes: { before: facility, after: updated },
  });
}
