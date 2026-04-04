import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { evaluateVitalSignAlertsForDailyLog } from "@/lib/infection-control/evaluate-vitals";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import type { Database } from "@/types/database";

type Body = { dailyLogId?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dailyLogId = body.dailyLogId?.trim();
  if (!dailyLogId) {
    return NextResponse.json({ error: "dailyLogId is required" }, { status: 400 });
  }

  const sessionClient = await createClient();
  const {
    data: { user },
    error: sessionErr,
  } = await sessionClient.auth.getUser();

  if (sessionErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[evaluate-vitals] service role", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: profile, error: profErr } = await admin
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile?.organization_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  const { data: log, error: logErr } = await admin
    .from("daily_logs")
    .select("*")
    .eq("id", dailyLogId)
    .is("deleted_at", null)
    .maybeSingle();

  if (logErr || !log) {
    return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  }

  const row = log as Database["public"]["Tables"]["daily_logs"]["Row"];

  if (row.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const okFac = await serviceRoleUserHasFacilityAccess(admin, {
    userId: user.id,
    facilityId: row.facility_id,
    organizationId: profile.organization_id,
    appRole: profile.app_role,
  });

  if (!okFac) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const role = profile.app_role;
  const adminRoles = new Set(["owner", "org_admin", "facility_admin", "nurse"]);
  if (!adminRoles.has(role) && row.logged_by !== user.id) {
    return NextResponse.json({ error: "Not allowed to evaluate vitals for this log" }, { status: 403 });
  }

  const result = await evaluateVitalSignAlertsForDailyLog(admin, row);

  return NextResponse.json({
    ok: true,
    alertsCreated: result.alertsCreated,
    skippedReason: result.skippedReason,
  });
}
