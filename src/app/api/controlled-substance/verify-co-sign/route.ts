import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type Body = {
  /** Single row (legacy) */
  countId?: string;
  /** Batch: all must be same facility, same outgoing, incoming null */
  countIds?: string[];
  email?: string;
  password?: string;
  facilityId?: string;
};

const ALLOWED_ROLES = new Set(["nurse", "caregiver"]);

/**
 * Verifies incoming staff credentials without creating a browser session.
 * Updates controlled_substance_counts when verification succeeds.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ verified: false, error: "Invalid JSON" }, { status: 400 });
  }

  const singleId = body.countId?.trim();
  const batchIds = Array.isArray(body.countIds)
    ? body.countIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const countIds = singleId ? [singleId] : batchIds;

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const facilityId = body.facilityId?.trim();

  if (countIds.length === 0 || !email || !password || !facilityId) {
    return NextResponse.json(
      { verified: false, error: "countId or countIds, email, password, and facilityId are required" },
      { status: 400 },
    );
  }

  const sessionClient = await createClient();
  const {
    data: { user: outgoing },
    error: sessionErr,
  } = await sessionClient.auth.getUser();

  if (sessionErr || !outgoing) {
    return NextResponse.json({ verified: false, error: "Not authenticated" }, { status: 401 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[verify-co-sign] service role client", e);
    return NextResponse.json(
      { verified: false, error: "Server configuration error" },
      { status: 503 },
    );
  }

  const { data: authData, error: authErr } = await admin.auth.signInWithPassword({
    email,
    password,
  });

  await admin.auth.signOut();

  if (authErr || !authData.user) {
    return NextResponse.json({ verified: false, error: "Invalid credentials" }, { status: 401 });
  }

  const incomingId = authData.user.id;

  if (incomingId === outgoing.id) {
    return NextResponse.json(
      { verified: false, error: "Incoming staff must be a different person than outgoing" },
      { status: 400 },
    );
  }

  const { data: profile, error: profErr } = await admin
    .from("user_profiles")
    .select("app_role, full_name, organization_id")
    .eq("id", incomingId)
    .maybeSingle();

  if (profErr || !profile) {
    return NextResponse.json({ verified: false, error: "Profile not found" }, { status: 403 });
  }

  if (!ALLOWED_ROLES.has(profile.app_role)) {
    return NextResponse.json(
      { verified: false, error: "Only nurse or caregiver may co-sign" },
      { status: 403 },
    );
  }

  const { data: facAccess, error: facErr } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", incomingId)
    .eq("facility_id", facilityId)
    .maybeSingle();

  if (facErr || !facAccess) {
    return NextResponse.json(
      { verified: false, error: "Staff does not have access to this facility" },
      { status: 403 },
    );
  }

  const { data: rows, error: rowErr } = await admin
    .from("controlled_substance_counts")
    .select("id, facility_id, organization_id, outgoing_staff_id, incoming_staff_id")
    .in("id", countIds)
    .is("deleted_at", null);

  if (rowErr || !rows?.length) {
    return NextResponse.json({ verified: false, error: "Count record(s) not found" }, { status: 404 });
  }

  if (rows.length !== countIds.length) {
    return NextResponse.json({ verified: false, error: "Some count IDs were not found" }, { status: 404 });
  }

  const orgId = rows[0].organization_id;
  for (const row of rows) {
    if (row.facility_id !== facilityId) {
      return NextResponse.json({ verified: false, error: "Facility mismatch" }, { status: 400 });
    }
    if (row.organization_id !== orgId) {
      return NextResponse.json({ verified: false, error: "Organization mismatch" }, { status: 400 });
    }
    if (row.outgoing_staff_id !== outgoing.id) {
      return NextResponse.json(
        { verified: false, error: "Only the outgoing staff who started these counts can complete co-sign" },
        { status: 403 },
      );
    }
    if (row.incoming_staff_id != null) {
      return NextResponse.json(
        { verified: false, error: "One or more counts already have an incoming signature" },
        { status: 409 },
      );
    }
  }

  const signedAt = new Date().toISOString();

  const { error: upErr } = await admin
    .from("controlled_substance_counts")
    .update({
      incoming_staff_id: incomingId,
      incoming_signed_at: signedAt,
    })
    .in("id", countIds)
    .is("incoming_staff_id", null);

  if (upErr) {
    console.error("[verify-co-sign] update", upErr);
    return NextResponse.json({ verified: false, error: "Could not save signature" }, { status: 500 });
  }

  const auditRows = rows.map((row) => ({
    table_name: "controlled_substance_counts",
    record_id: row.id,
    action: "UPDATE" as const,
    new_data: {
      event: "incoming_co_sign_verified",
      incoming_staff_id: incomingId,
      outgoing_staff_id: outgoing.id,
    },
    user_id: incomingId,
    organization_id: row.organization_id,
    facility_id: row.facility_id,
  }));

  const { error: auditErr } = await admin.from("audit_log").insert(auditRows);

  if (auditErr) {
    console.warn("[verify-co-sign] audit_log insert failed", auditErr);
  }

  const displayName =
    profile.full_name?.trim() ||
    authData.user.email ||
    email;

  return NextResponse.json({
    verified: true,
    user_id: incomingId,
    display_name: displayName,
  });
}
