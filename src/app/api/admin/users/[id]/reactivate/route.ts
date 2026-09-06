/**
 * POST /api/admin/users/[id]/reactivate — Reactivate soft-deleted user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { reactivateUserSchema } from "@/lib/validation/user-management";
import { adminEnableUser } from "@/lib/supabase/admin-client";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";
import { logError } from "@/lib/observability/logger";
import { canActorManageTarget } from "@/lib/rbac";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const admin = actor.admin;

  const { id: targetUserId } = await ctx.params;

  // Find soft-deleted target
  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, app_role, is_active, deleted_at")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id!)
    .or("deleted_at.not.is.null,is_active.eq.false")
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json({ error: "Deleted user not found" }, { status: 404 });
  }
  if (!canActorManageTarget(actor.app_role, target.app_role)) {
    return NextResponse.json(
      { error: "Only owners can reactivate owner accounts" },
      { status: 403 },
    );
  }

  // Optional reason
  let reason: string | undefined;
  try {
    const body = await request.json();
    const parsed = reactivateUserSchema.safeParse(body);
    if (parsed.success) reason = parsed.data.reason;
  } catch {
    // No body — reason is optional
  }

  // Re-enable auth account
  try {
    await adminEnableUser(targetUserId);
  } catch (err) {
    logError("admin.users.reactivate", err, {
      action: "enable_auth",
      targetUserId,
    });
    return NextResponse.json({ error: "Auth reactivation failed. Retry reactivation.", sync_status: "retry_required" }, { status: 502 });
  }

  const now = new Date().toISOString();

  // Reactivate profile
  const { data: updated, error: updateErr } = await admin
    .from("user_profiles")
    .update({ deleted_at: null, is_active: true, updated_at: now })
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id!)
    .select("id, organization_id, email, full_name, app_role, is_active, deleted_at, updated_at")
    .single();
  if (updateErr) {
    return NextResponse.json({ error: "Failed to reactivate user" }, { status: 500 });
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId,
    action: "reactivate",
    changes: { before: { is_active: false, deleted_at: target.deleted_at }, after: { is_active: true, deleted_at: null } },
    reason,
  });

  return NextResponse.json({ data: updated });
}
