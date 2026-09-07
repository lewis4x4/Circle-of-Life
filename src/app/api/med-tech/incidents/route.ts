import { NextResponse } from "next/server";

import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
type Body = {
  shiftId?: string;
};

const ALLOWED_ROLES = ["owner", "org_admin", "facility_admin", "nurse", "caregiver", "med_tech"] as const;

function incidentPrefix(facilityName: string, settings: Record<string, unknown> | null | undefined) {
  const fromSettings = typeof settings?.incident_report_prefix === "string" ? settings.incident_report_prefix.trim() : "";
  if (fromSettings.length > 0) return fromSettings.toUpperCase().slice(0, 12);
  const clean = facilityName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (clean.slice(0, 3) || "HVN").slice(0, 12);
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const shiftId = body.shiftId?.trim();
  if (!shiftId) {
    return NextResponse.json({ ok: false, error: "shiftId is required" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ALLOWED_ROLES,
    scope: "med-tech.incidents",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const { data: shift, error: shiftError } = await admin
    .from("med_tech_shifts" as never)
    .select("id, user_id, organization_id, facility_id")
    .eq("id", shiftId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  const safeShift = shift as { id: string; user_id: string; organization_id: string; facility_id: string } | null;
  if (shiftError || !safeShift || safeShift.user_id !== actor.id) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const facilityId = safeShift.facility_id;
  const hasFacilityAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId,
    organizationId: actor.organizationId,
  });
  if (!hasFacilityAccess) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await admin
    .from("facilities")
    .select("id, organization_id, name, timezone, settings")
    .eq("id", facilityId)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility || facility.organization_id !== actor.organizationId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: facility.timezone?.trim() || "America/New_York",
      year: "numeric",
    }).format(now),
  );

  const prefix = incidentPrefix(facility.name, facility.settings as Record<string, unknown> | null | undefined);

  const latestIncident = await admin
    .from("incidents")
    .select("incident_number")
    .eq("facility_id", facilityId)
    .like("incident_number", `${prefix}-${year}-%`)
    .order("incident_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestIncident.error) {
    return NextResponse.json({ ok: false, error: "Could not generate incident number" }, { status: 500 });
  }

  const currentLast = (() => {
    const num = (latestIncident.data as { incident_number?: string } | null)?.incident_number ?? "";
    const suffix = num.split("-").at(-1) ?? "";
    const parsed = Number.parseInt(suffix, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  })();

  const nextNumber = currentLast + 1;

  const incidentNumber = `${prefix}-${year}-${String(nextNumber).padStart(4, "0")}`;

  return NextResponse.json({
    ok: true,
    facilityId,
    organizationId: actor.organizationId,
    incidentNumber,
  });
}
