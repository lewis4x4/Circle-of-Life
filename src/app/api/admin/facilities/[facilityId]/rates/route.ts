/**
 * GET    /api/admin/facilities/[facilityId]/rates  — List rate schedule versions
 * POST   /api/admin/facilities/[facilityId]/rates  — Create new rate version
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { createRateSchema, listRatesQuerySchema } from "@/lib/validation/facility-admin";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── GET: List Rate Versions ───────────────────────────────────────

export async function GET(request: NextRequest, ctx: RouteContext) {
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

  // Parse query
  const url = new URL(request.url);
  const rawParams: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = rawParams[key];
    if (existing) {
      rawParams[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      rawParams[key] = value;
    }
  });

  const parsed = listRatesQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { rate_type, active_only } = parsed.data;

  // Build query
  let query = untypedAdmin
    .from("rate_schedule_versions")
    .select(
      "id, facility_id, rate_type, amount_cents, effective_from, effective_to, rate_confirmed, approved_by, approved_at, notes, created_at",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("effective_from", { ascending: false });

  if (rate_type) {
    query = query.eq("rate_type", rate_type);
  }

  if (active_only) {
    query = query.is("effective_to", null);
  }

  const { data: rates, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to fetch rates" }, { status: 500 });
  }

  return NextResponse.json({
    data: rates ?? [],
  });
}

// ── POST: Create Rate Version ─────────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
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

  const parsed = createRateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { rate_type, amount_cents, effective_from, notes, rate_confirmed } = parsed.data;

  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

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
    // Close previous active rate of same type:
    // Set effective_to = new rate's effective_from - 1 day
    const previousDate = new Date(effective_from);
    previousDate.setDate(previousDate.getDate() - 1);
    const effective_to = previousDate.toISOString().split("T")[0];

    await untypedAdmin
      .from("rate_schedule_versions")
      .update({ effective_to, updated_at: new Date().toISOString() })
      .eq("facility_id", facilityId)
      .eq("rate_type", rate_type)
      .is("effective_to", null)
      .is("deleted_at", null);

    // Create new rate
    const { data: newRate, error: insertErr } = await untypedAdmin
      .from("rate_schedule_versions")
      .insert({
        facility_id: facilityId,
        organization_id: actor.organization_id!,
        rate_type,
        amount_cents,
        effective_from,
        effective_to: null,
        notes: notes ?? null,
        rate_confirmed: rate_confirmed ?? false,
        created_by: actor.id,
      } as Record<string, unknown>)
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: "Failed to create rate" }, { status: 500 });
    }

    return NextResponse.json({ data: newRate }, { status: 201 });
  } catch (err) {
    console.error("[rate-create] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
