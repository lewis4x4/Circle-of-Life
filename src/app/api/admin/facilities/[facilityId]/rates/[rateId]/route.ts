/**
 * PATCH /api/admin/facilities/[facilityId]/rates/[rateId] — Update rate version fields (e.g. rate_confirmed)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { patchRateVersionSchema } from "@/lib/validation/facility-admin";

const uuidSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ facilityId: string; rateId: string }>;
}

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

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!["owner", "org_admin"].includes(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { facilityId, rateId } = await ctx.params;

  if (!uuidSchema.safeParse(facilityId).success || !uuidSchema.safeParse(rateId).success) {
    return NextResponse.json({ error: "Invalid facility or rate id" }, { status: 400 });
  }

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

  const { data: existing, error: fetchErr } = await admin
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

  const { data: updated, error: updErr } = await admin
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
