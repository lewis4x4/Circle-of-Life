/**
 * POST /api/admin/users/[id]/reset-password — Reset a user's password.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import {
  adminSendPasswordResetEmail,
  adminSetUserSignInReadyWithTemporaryPassword,
} from "@/lib/supabase/admin-client";
import { resetUserPasswordSchema } from "@/lib/validation/user-management";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";
import { logError } from "@/lib/observability/logger";
import { canActorManageTarget } from "@/lib/rbac";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID_RE.test(targetUserId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  if (actor.id === targetUserId) {
    return NextResponse.json({ error: "Cannot reset your own password here" }, { status: 422 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = resetUserPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { mode } = parsed.data;

  // Find target
  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, app_role, is_active, deleted_at")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id!)
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!canActorManageTarget(actor.app_role, target.app_role)) {
    return NextResponse.json(
      { error: "Only owners can reset owner passwords" },
      { status: 403 },
    );
  }
  if (!target.email) {
    return NextResponse.json({ error: "User does not have an email address" }, { status: 422 });
  }

  let temporaryPassword: string | undefined;
  let temporaryPasswordExpiry: string | null = null;
  let auditWritten = false;

  try {
    if (mode === "email") {
      await writeUserAuditEntry({
        organizationId: actor.organization_id!,
        actingUserId: actor.id,
        targetUserId,
        action: "password_reset",
        changes: { before: {}, after: {}, meta: { mode: "email" } },
      });
      auditWritten = true;

      await adminSendPasswordResetEmail(target.email);
    } else {
      const { temporary_password, expires_at } =
        await adminSetUserSignInReadyWithTemporaryPassword(targetUserId);
      temporaryPassword = temporary_password;
      temporaryPasswordExpiry = expires_at;
    }
  } catch (err) {
    logError("admin.users.reset_password", err, {
      action: "reset_password",
      targetUserId,
      mode,
    });
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }

  // Audit — never include temporaryPassword in changes, reason, logs, or metadata.
  if (!auditWritten) {
    await writeUserAuditEntry({
      organizationId: actor.organization_id!,
      actingUserId: actor.id,
      targetUserId,
      action: "password_reset",
      changes: { before: {}, after: { mode } },
    });
  }

  if (mode === "temp") {
    return NextResponse.json({
      ok: true,
      mode,
      temporary_password: temporaryPassword,
      temporary_password_expires_at: temporaryPasswordExpiry,
    });
  }

  return NextResponse.json({ ok: true, mode });
}
