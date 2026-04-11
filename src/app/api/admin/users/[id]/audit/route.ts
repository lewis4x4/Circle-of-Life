/**
 * GET /api/admin/users/[id]/audit — Audit trail for a specific user.
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessTargetUser, requireAdminApiActor } from "@/lib/admin/api-auth";
import type { Database } from "@/types/database";
import { auditLogQuerySchema } from "@/lib/validation/user-management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type UserManagementAuditRow = Pick<
  Database["public"]["Tables"]["user_management_audit_log"]["Row"],
  "id" | "acting_user_id" | "target_user_id" | "action" | "resource_type" | "changes" | "reason" | "created_at"
>;

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const admin = actor.admin;

  const { id: targetUserId } = await ctx.params;
  if (!(await actorCanAccessTargetUser(actor, targetUserId))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify target is in same org
  const { data: target } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id!)
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
    .from("user_management_audit_log" as never)
    .select("id, acting_user_id, target_user_id, action, resource_type, changes, reason, created_at", { count: "exact" })
    .eq("organization_id" as never, actor.organization_id!)
    .eq("target_user_id" as never, targetUserId);

  if (action) query = query.eq("action" as never, action);
  if (start_date) query = query.gte("created_at" as never, start_date);
  if (end_date) query = query.lte("created_at" as never, end_date);

  query = query.order("created_at" as never, { ascending: false }).range(offset, offset + page_size - 1);

  const queryResult = await query;
  const entries = (queryResult.data ?? []) as UserManagementAuditRow[];
  const count = queryResult.count ?? 0;
  const queryErr = queryResult.error;
  if (queryErr) {
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  // Enrich acting_user info
  const actorIds = [...new Set(entries.map((entry) => entry.acting_user_id))];
  const actorMap: Record<string, { email: string; full_name: string }> = {};
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await admin
      .from("user_profiles")
      .select("id, email, full_name")
      .in("id", actorIds as string[]);
    for (const p of actorProfiles ?? []) {
      actorMap[p.id] = { email: p.email, full_name: p.full_name };
    }
  }

  const data = entries.map((entry) => ({
    ...entry,
    acting_user: actorMap[entry.acting_user_id] ?? { email: "unknown", full_name: "Unknown" },
  }));

  return NextResponse.json({
    data,
    pagination: {
      total: count,
      page,
      page_size,
      total_pages: Math.ceil(count / page_size),
      has_next: offset + page_size < count,
    },
  });
}
