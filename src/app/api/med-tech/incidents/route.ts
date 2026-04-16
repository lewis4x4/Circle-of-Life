import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
type Body = {
  shiftId?: string;
};

const ALLOWED_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse", "caregiver", "med_tech"]);

function incidentPrefix(facilityName: string, settings: Record<string, unknown> | null | undefined) {
  const fromSettings = typeof settings?.incident_report_prefix === "string" ? settings.incident_report_prefix.trim() : "";
  if (fromSettings.length > 0) return fromSettings.toUpperCase().slice(0, 12);
  const clean = facilityName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (clean.slice(0, 3) || "HVN").slice(0, 12);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

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

  const admin = createServiceRoleClient();

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, app_role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || !ALLOWED_ROLES.has(profile.app_role)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { data: shift, error: shiftError } = await admin
    .from("med_tech_shifts" as never)
    .select("id, user_id, organization_id, facility_id")
    .eq("id", shiftId)
    .is("deleted_at", null)
    .maybeSingle();

  const safeShift = shift as { id: string; user_id: string; organization_id: string; facility_id: string } | null;
  if (shiftError || !safeShift || safeShift.user_id !== user.id || safeShift.organization_id !== profile.organization_id) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const facilityId = safeShift.facility_id;
  const hasFacilityAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: user.id,
    facilityId,
    organizationId: profile.organization_id,
    appRole: profile.app_role,
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

  if (facilityError || !facility || facility.organization_id !== profile.organization_id) {
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
    return NextResponse.json({ ok: false, error: latestIncident.error.message }, { status: 400 });
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
    organizationId: profile.organization_id,
    incidentNumber,
  });
}
