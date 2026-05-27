/**
 * POST /api/admin/users/[id]/reset-password — Reset a user's password.
 */

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { resetUserPasswordSchema } from "@/lib/validation/user-management";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";
import { logError } from "@/lib/observability/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const admin = actor.admin;

  const { id: targetUserId } = await ctx.params;
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
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!target.email) {
    return NextResponse.json({ error: "User does not have an email address" }, { status: 422 });
  }

  let temporaryPassword: string | undefined;

  try {
    if (mode === "email") {
      const { error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: target.email,
      });
      if (error) {
        return NextResponse.json({ error: "Failed to send password reset email" }, { status: 500 });
      }
    } else {
      temporaryPassword = generateTemporaryPassword();
      const { error } = await admin.auth.admin.updateUserById(targetUserId, {
        password: temporaryPassword,
      });
      if (error) {
        return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
      }
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
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId,
    action: "user.password.reset" as never,
    changes: { before: {}, after: { mode } },
  });

  if (mode === "temp") {
    return NextResponse.json({
      ok: true,
      mode,
      temporary_password: temporaryPassword,
    });
  }

  return NextResponse.json({ ok: true, mode });
}
