/**
 * DELETE /api/admin/users/[id]/hard-delete — Retire a login while preserving identity and history.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { canActorHardDeleteTarget } from "@/lib/rbac";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { hardDeleteUserSchema } from "@/lib/validation/user-management";
import {
  commitRestrictiveUserAccess,
} from "@/lib/admin/user-access-lifecycle";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TargetProfile = {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string;
  app_role: string;
  deleted_at: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner"] });
  if ("response" in auth) {
    if (auth.response.status === 403) {
      return json(403, { ok: false, reason: "actor_not_owner" });
    }
    return auth.response;
  }
  const { actor } = auth;
  const admin = actor.admin;

  const { id: targetUserId } = await ctx.params;
  if (!UUID_STRING_RE.test(targetUserId)) {
    return json(400, { ok: false, reason: "invalid_user_id" });
  }
  if (actor.id === targetUserId) {
    return json(403, { ok: false, reason: "self_delete_not_allowed" });
  }

  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, app_role, deleted_at")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();

  const targetProfile = target as TargetProfile | null;
  if (targetErr || !targetProfile) {
    return json(404, { ok: false, reason: "not_found" });
  }
  if (targetProfile.organization_id !== actor.organization_id) {
    return json(404, { ok: false, reason: "not_found" });
  }

  if (!canActorHardDeleteTarget(actor.app_role, targetProfile.app_role)) {
    return json(403, { ok: false, reason: "target_role_protected" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  const parsed = hardDeleteUserSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  if (normalizeEmail(parsed.data.confirm_email) !== normalizeEmail(targetProfile.email)) {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  let quarantine;
  try {
    quarantine = await commitRestrictiveUserAccess(admin, {
      targetUserId,
      actingUserId: actor.id,
      organizationId: actor.organization_id,
      operation: "hard_delete",
      reason: "Login retirement approved; identity and all history retained",
      requestKey: request.headers.get("idempotency-key"),
    });
  } catch (err) {
    logError("admin.users.hard_delete", err, { action: "quarantine", targetUserId });
    return json(500, { ok: false, reason: "quarantine_failed" });
  }

  return NextResponse.json({
    ok: quarantine.sync_status === "synchronized",
    retired_user_id: targetUserId,
    identity_retained: true,
    sync_status: quarantine.sync_status,
    job_id: quarantine.job_id,
  }, { status: quarantine.sync_status === "synchronized" ? 200 : 202 });
}
