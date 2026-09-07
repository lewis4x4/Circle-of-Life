/**
 * POST /api/admin/users/[id]/reactivate — Reactivate soft-deleted user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { reactivateUserSchema } from "@/lib/validation/user-management";
import { logError } from "@/lib/observability/logger";
import { canActorManageTarget } from "@/lib/rbac";
import { commitExpansiveUserAccess } from "@/lib/admin/user-access-lifecycle";

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
    .select("id, organization_id, email, full_name, app_role, is_active, deleted_at, auth_claim_version")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id!)
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
  let facilities: Array<{ facility_id: string; is_primary: boolean }> = [];
  try {
    const body = await request.json();
    const parsed = reactivateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }
    reason = parsed.data.reason;
    facilities = parsed.data.facilities;
  } catch {
    // Empty body is valid only for organization-wide roles.
  }

  if (!(["owner", "org_admin"] as string[]).includes(target.app_role) && facilities.length === 0) {
    return NextResponse.json(
      { error: "Select the facilities to restore before reactivating this user" },
      { status: 422 },
    );
  }

  let updated;
  try {
    updated = await commitExpansiveUserAccess(admin, {
      targetUserId,
      actingUserId: actor.id,
      organizationId: actor.organization_id!,
      operation: "reactivate",
      requestKey: request.headers.get("idempotency-key"),
      facilityIds: facilities.map((row) => row.facility_id),
      primaryFacilityId: facilities.find((row) => row.is_primary)?.facility_id,
      reason,
    });
  } catch (error) {
    logError("admin.users.reactivate", error, { action: "commit_expansion", targetUserId });
    return NextResponse.json(
      { error: "Failed to reactivate user. Existing database authority is unchanged." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: updated, sync_status: updated.sync_status },
    { status: updated.sync_status === "synchronized" ? 200 : 202 });
}
