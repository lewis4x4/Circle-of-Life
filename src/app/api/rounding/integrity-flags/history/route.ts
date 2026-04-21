import { NextRequest, NextResponse } from "next/server";

import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

type HistoryRow = {
  id: string;
  record_id: string;
  action: string;
  changed_fields: string[] | null;
  user_id: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can review integrity history" }, { status: 403 });
  }

  const facilityId = request.nextUrl.searchParams.get("facilityId")?.trim();
  const idsRaw = request.nextUrl.searchParams.get("ids")?.trim() ?? "";
  const ids = idsRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, historyById: {} });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data, error } = await context.admin
    .from("audit_log")
    .select("id, record_id, action, changed_fields, user_id, created_at")
    .eq("table_name", "resident_observation_integrity_flags")
    .eq("facility_id", facilityId)
    .in("record_id", ids)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[rounding/integrity-flags/history] audit log", error);
    return NextResponse.json({ error: "Could not load integrity history" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as HistoryRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await context.admin
      .from("user_profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const row of profiles ?? []) {
      nameById.set(row.id, row.full_name?.trim() || row.id);
    }
  }

  const historyById = rows.reduce<Record<string, Array<{
    id: string;
    action: string;
    changedFields: string[];
    actorName: string;
    createdAt: string;
  }>>>((acc, row) => {
    const recordId = row.record_id;
    const existing = acc[recordId] ?? [];
    existing.push({
      id: row.id,
      action: row.action,
      changedFields: row.changed_fields ?? [],
      actorName: row.user_id ? nameById.get(row.user_id) ?? row.user_id : "System",
      createdAt: row.created_at,
    });
    acc[recordId] = existing;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, historyById });
}
