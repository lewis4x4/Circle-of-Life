/**
 * GET metadata for Facility Header audit KPIs (owner/org_admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;

  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const { admin } = auth.actor;
  const untyped = asUntypedAdmin(admin);

  const { count: eventsAllTime, error: cErr } = await untyped
    .from("facility_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId);

  if (cErr) {
    return NextResponse.json({ error: "Failed to summarize audit log" }, { status: 500 });
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenIso = sevenDaysAgo.toISOString();

  const { count: eventsLast7d, error: wErr } = await untyped
    .from("facility_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .gte("changed_at", sevenIso);

  if (wErr) {
    return NextResponse.json({ error: "Failed to summarize audit log window" }, { status: 500 });
  }

  const { data: lastRow } = await untyped
    .from("facility_audit_log")
    .select("changed_at, changed_by")
    .eq("facility_id", facilityId)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: weekActors } = await untyped
    .from("facility_audit_log")
    .select("changed_by")
    .eq("facility_id", facilityId)
    .gte("changed_at", sevenIso)
    .not("changed_by", "is", null);

  const counts = new Map<string, number>();
  for (const row of weekActors ?? []) {
    const id = row.changed_by as string | null;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let topUserId: string | null = null;
  let topCount = 0;
  counts.forEach((n, uid) => {
    if (n > topCount) {
      topCount = n;
      topUserId = uid;
    }
  });

  let topUserDisplay: string | null = null;
  if (topUserId != null) {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("email, full_name")
      .eq("id", topUserId)
      .maybeSingle();
    topUserDisplay = formatUploadedByProfile({
      email: prof?.email ?? undefined,
      full_name: prof?.full_name ?? undefined,
    });
  }

  const lastAt = typeof lastRow?.changed_at === "string" ? lastRow.changed_at : null;

  return NextResponse.json({
    events_last_7d: eventsLast7d ?? 0,
    events_all_time: eventsAllTime ?? 0,
    last_event_at: lastAt,
    top_user_display: weekActors && weekActors.length > 0 ? topUserDisplay : null,
    retention_years: 7,
  });
}
