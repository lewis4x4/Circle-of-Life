/**
 * GET /api/admin/users/[id]/audit — Audit trail for a specific user.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { auditLogQuerySchema } from "@/lib/validation/user-management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error: sessionErr,
  } = await supabase.auth.getUser();
  if (sessionErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  // Actor profile
  const { data: actor } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!actor) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  const allowedRoles = new Set(["owner", "org_admin", "facility_admin"]);
  if (!allowedRoles.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id: targetUserId } = await ctx.params;

  // Verify target is in same org
  const { data: target } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Parse query
  const url = new URL(request.url);
  const rawParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    rawParams[k] = v;
  });
  const parsed = auditLogQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { page, page_size, action, start_date, end_date } = parsed.data;
  const offset = (page - 1) * page_size;

  // Build query
  let query = admin
    .from("user_management_audit_log")
    .select("id, acting_user_id, target_user_id, action, resource_type, changes, reason, created_at", { count: "exact" })
    .eq("organization_id", actor.organization_id)
    .eq("target_user_id", targetUserId);

  if (action) query = query.eq("action", action);
  if (start_date) query = query.gte("created_at", start_date);
  if (end_date) query = query.lte("created_at", end_date);

  query = query.order("created_at", { ascending: false }).range(offset, offset + page_size - 1);

  const { data: entries, count, error: queryErr } = await query;
  if (queryErr) {
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  // Enrich acting_user info
  const actorIds = [...new Set((entries ?? []).map((e) => e.acting_user_id))];
  const actorMap: Record<string, { email: string; full_name: string }> = {};
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await admin
      .from("user_profiles")
      .select("id, email, full_name")
      .in("id", actorIds);
    for (const p of actorProfiles ?? []) {
      actorMap[p.id] = { email: p.email, full_name: p.full_name };
    }
  }

  const data = (entries ?? []).map((e) => ({
    ...e,
    acting_user: actorMap[e.acting_user_id] ?? { email: "unknown", full_name: "Unknown" },
  }));

  return NextResponse.json({
    data,
    pagination: {
      total: count ?? 0,
      page,
      page_size,
      total_pages: Math.ceil((count ?? 0) / page_size),
      has_next: offset + page_size < (count ?? 0),
    },
  });
}
