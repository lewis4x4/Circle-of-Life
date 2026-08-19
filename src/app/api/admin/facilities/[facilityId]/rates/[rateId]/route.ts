/**
 * PATCH /api/admin/facilities/[facilityId]/rates/[rateId] — Update rate version fields (e.g. rate_confirmed)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAdminApiActor,
  requireFacilityAccess,
} from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { patchRateVersionSchema } from "@/lib/validation/facility-admin";

const uuidSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ facilityId: string; rateId: string }>;
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin"] });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId, rateId } = await ctx.params;

  if (!uuidSchema.safeParse(facilityId).success || !uuidSchema.safeParse(rateId).success) {
    return NextResponse.json({ error: "Invalid facility or rate id" }, { status: 400 });
  }

  const facilityGate = await requireFacilityAccess(actor, facilityId);
  if ("response" in facilityGate) return facilityGate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchRateVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

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

  const { data: existing, error: fetchErr } = await untypedAdmin
    .from("rate_schedule_versions")
    .select("id, facility_id, organization_id")
    .eq("id", rateId)
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Rate version not found" }, { status: 404 });
  }

  const { data: updated, error: updErr } = await untypedAdmin
    .from("rate_schedule_versions")
    .update({
      rate_confirmed: parsed.data.rate_confirmed,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq("id", rateId)
    .eq("organization_id", actor.organization_id!)
    .select()
    .single();

  if (updErr) {
    return NextResponse.json({ error: "Failed to update rate" }, { status: 500 });
  }

  return NextResponse.json({ data: updated });
}
