/**
 * POST /api/admin/users/[id]/reactivate — Reactivate soft-deleted user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { reactivateUserSchema } from "@/lib/validation/user-management";
import { adminEnableUser } from "@/lib/supabase/admin-client";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";

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
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json({ error: "Deleted user not found" }, { status: 404 });
  }
  if (target.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const now = new Date().toISOString();

  // Reactivate profile
  const { data: updated, error: updateErr } = await admin
    .from("user_profiles")
    .update({ deleted_at: null, is_active: true, updated_at: now })
    .eq("id", targetUserId)
    .select()
    .single();
  if (updateErr) {
    return NextResponse.json({ error: "Failed to reactivate user" }, { status: 500 });
  }

  // Re-enable auth account
  try {
    await adminEnableUser(targetUserId);
  } catch (err) {
    console.error("[user-reactivate] Failed to enable auth:", err);
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
