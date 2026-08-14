import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getRoundingRequestContext } from "@/lib/rounding/auth";
import {
  fallbackObservationPlanTemplates,
  mapObservationPlanTemplateRow,
} from "@/lib/rounding/observation-plan-templates";

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await context.admin
    .from("facilities")
    .select("name")
    .eq("id", facilityId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { data, error } = await context.admin
    .from("resident_observation_templates")
    .select("id, name, description, preset_definition, active")
    .eq("organization_id", context.organizationId)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    logError("rounding.plans.templates", error, { facilityId });
    return NextResponse.json({
      templates: fallbackObservationPlanTemplates(facility.name),
      source: "fallback",
    });
  }

  const templates = (data ?? [])
    .map((row) =>
      mapObservationPlanTemplateRow({
        id: row.id,
        name: row.name,
        description: row.description,
        preset_definition: (row.preset_definition ?? null) as Record<string, unknown> | null,
        active: row.active,
      }),
    )
    .filter((template): template is NonNullable<typeof template> => template != null);

  if (templates.length === 0) {
    return NextResponse.json({
      templates: fallbackObservationPlanTemplates(facility.name),
      source: "fallback",
    });
  }

  return NextResponse.json({ templates, source: "database" });
}
