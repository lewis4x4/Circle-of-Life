import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runOutbreakDetectionAfterSurveillance } from "@/lib/infection-control/outbreak-detection";

type Body = { surveillanceId?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const surveillanceId = body.surveillanceId?.trim();
  if (!surveillanceId) {
    return NextResponse.json({ error: "surveillanceId is required" }, { status: 400 });
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
    console.error("[evaluate-outbreak] service role", e);
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

  const allowed = new Set(["owner", "org_admin", "facility_admin", "nurse"]);
  if (!allowed.has(profile.app_role)) {
    return NextResponse.json({ error: "Only nurse or admin may run outbreak detection" }, { status: 403 });
  }

  const { data: surv, error: sErr } = await admin
    .from("infection_surveillance")
    .select("facility_id, organization_id, identified_by")
    .eq("id", surveillanceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sErr || !surv) {
    return NextResponse.json({ error: "Surveillance record not found" }, { status: 404 });
  }

  if (surv.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const { data: facAccess, error: facErr } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", user.id)
    .eq("facility_id", surv.facility_id)
    .maybeSingle();

  if (facErr || !facAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const outcome = await runOutbreakDetectionAfterSurveillance(admin, surveillanceId, surv.identified_by);

  return NextResponse.json({ ok: true, outcome: outcome.outcome });
}
