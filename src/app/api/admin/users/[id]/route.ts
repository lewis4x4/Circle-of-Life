/**
 * GET    /api/admin/users/[id]         — User detail
 * PATCH  /api/admin/users/[id]         — Update user
 * DELETE /api/admin/users/[id]         — Soft-delete user
 */

import { NextRequest, NextResponse } from "next/server";
import {
  actorCanAccessTargetUser,
  actorHasOrgWideFacilityScope,
  listActorAccessibleFacilityIds,
  requireAdminApiActor,
} from "@/lib/admin/api-auth";
import { canManageUser, getRoleTier } from "@/lib/rbac";
import type { Database } from "@/types/database";
import { updateUserSchema, deleteUserSchema } from "@/lib/validation/user-management";
import {
  adminGetAuthSnapshotsByIds,
} from "@/lib/supabase/admin-client";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";
import { logError } from "@/lib/observability/logger";
import {
  commitExpansiveUserAccess,
  commitRestrictiveUserAccess,
} from "@/lib/admin/user-access-lifecycle";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type UserDetailRow = Pick<
  Database["public"]["Tables"]["user_profiles"]["Row"],
  | "id"
  | "organization_id"
  | "email"
  | "full_name"
  | "phone"
  | "app_role"
  | "job_title"
  | "avatar_url"
  | "is_active"
  | "last_login_at"
  | "manager_user_id"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "auth_claim_version"
>;

type UserUpdateTargetRow = Pick<
  Database["public"]["Tables"]["user_profiles"]["Row"],
  "id" | "organization_id" | "email" | "full_name" | "phone" | "app_role" | "job_title" | "is_active" | "manager_user_id" | "auth_claim_version"
>;

type UserFacilityAccessDetailRow = Pick<
  Database["public"]["Tables"]["user_facility_access"]["Row"],
  "id" | "facility_id" | "is_primary" | "granted_at" | "granted_by" | "revoked_at" | "revoked_by"
> & {
  facilities: { name: string | null; organization_id?: string | null } | null;
};

// ── GET: User Detail ──────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "manager"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { id } = await ctx.params;
  const admin = actor.admin;
  if (!(await actorCanAccessTargetUser(actor, id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const profileResult = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, phone, app_role, job_title, avatar_url, is_active, last_login_at, manager_user_id, created_at, updated_at, deleted_at, auth_claim_version")
    .eq("id", id)
    .eq("organization_id", actor.organization_id!)
    .maybeSingle();
  const profile = profileResult.data as UserDetailRow | null;
  const error = profileResult.error;
  if (error || !profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (profile.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authSnapshots = await adminGetAuthSnapshotsByIds([id]);
  const { data: syncData, error: syncError } = await admin.rpc("user_auth_sync_status_review" as never, {
    p_target_user_id: id, p_organization_id: actor.organization_id,
  } as never);
  const sync = syncData as { phase: string; operation: string; job_id: string } | null;

  // Facility access
  const facilitiesResult = await admin
    .from("user_facility_access")
    .select("id, facility_id, is_primary, granted_at, granted_by, revoked_at, revoked_by, facilities!inner(name, organization_id)")
    .eq("user_id", id)
    .eq("facilities.organization_id", actor.organization_id!)
    .order("granted_at", { ascending: false });
  const facilities = (facilitiesResult.data ?? []) as UserFacilityAccessDetailRow[];

  const actorFacilityIds = actorHasOrgWideFacilityScope(actor)
    ? null
    : await listActorAccessibleFacilityIds(actor);
  const visibleFacilities =
    actorFacilityIds == null
      ? facilities ?? []
      : facilities.filter((facility) => actorFacilityIds.includes(facility.facility_id));

  return NextResponse.json({
    data: {
      ...profile,
      login_email: authSnapshots[id]?.email ?? null,
      auth_app_role: authSnapshots[id]?.app_role ?? null,
      access_sync: sync,
      identity_sync_status: syncError || !authSnapshots[id] ? "unavailable" :
        sync && sync.phase !== "finalized" ? "retry_required" :
        authSnapshots[id].email.toLowerCase() === profile.email.toLowerCase()
        && authSnapshots[id].app_role === profile.app_role
        && (authSnapshots[id].auth_claim_version ?? 1) === profile.auth_claim_version
        && (Boolean(authSnapshots[id].banned_until && new Date(authSnapshots[id].banned_until).getTime() > Date.now()) === !profile.is_active)
          ? "synchronized" : "retry_required",
      last_login_at: authSnapshots[id]?.last_sign_in_at ?? profile.last_login_at,
      facilities: visibleFacilities.map((facility) => ({
        id: facility.id,
        facility_id: facility.facility_id,
        facility_name: facility.facilities?.name ?? "",
        is_primary: facility.is_primary,
        granted_at: facility.granted_at,
        granted_by: facility.granted_by,
        revoked_at: facility.revoked_at,
        revoked_by: facility.revoked_by,
      })),
    },
  });
}

// ── PATCH: Update User ────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "manager"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { id } = await ctx.params;

  // Cannot modify self's role/status (but can edit own profile fields)
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const updates = parsed.data;
  if (updates.app_role === undefined && updates.is_active === undefined && !(await actorCanAccessTargetUser(actor, id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const admin = actor.admin;

  // Fetch target — new columns not yet in generated types
  const targetResult = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, phone, app_role, job_title, is_active, manager_user_id, auth_claim_version")
    .eq("id", id)
    .eq("organization_id", actor.organization_id!)
    .maybeSingle();
  const target = targetResult.data as UserUpdateTargetRow | null;
  const targetErr = targetResult.error;
  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Authorization checks
  const isSelf = actor.id === id;

  // Role change requires canManageUser
  if (updates.app_role !== undefined) {
    if (isSelf) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 422 });
    }
    if (!canManageUser(actor.app_role, target.app_role)) {
      return NextResponse.json({ error: "Cannot modify this user's role" }, { status: 403 });
    }
    if (!canManageUser(actor.app_role, updates.app_role)) {
      return NextResponse.json(
        { error: "Cannot assign a role at or above your own level" },
        { status: 403 },
      );
    }
  }

  // Deactivation checks
  if (updates.is_active === false && isSelf) {
    return NextResponse.json({ error: "Cannot deactivate yourself" }, { status: 422 });
  }

  // Non-self edits require management permission
  if (!isSelf && !canManageUser(actor.app_role, target.app_role)) {
    return NextResponse.json({ error: "Cannot modify this user" }, { status: 403 });
  }

  if (updates.email !== undefined && updates.email !== target.email) {
    return NextResponse.json({ error: "Use the login-email command to change sign-in identity" }, { status: 422 });
  }
  if (updates.is_active === true && !target.is_active) {
    return NextResponse.json({ error: "Use the reactivate command to restore account access" }, { status: 422 });
  }
  if (updates.app_role !== undefined && updates.is_active === false) {
    return NextResponse.json(
      { error: "Change role and deactivate access as separate commands" },
      { status: 422 },
    );
  }

  let accessResult: Awaited<ReturnType<typeof commitRestrictiveUserAccess>> | undefined;
  try {
    if (updates.app_role !== undefined) {
      // Same-tier changes (and explicit resync) remain database-first.
      const input = {
        targetUserId: id, actingUserId: actor.id, organizationId: actor.organization_id,
        desiredRole: updates.app_role, requestKey: request.headers.get("idempotency-key"),
      };
      accessResult = getRoleTier(updates.app_role) <= getRoleTier(target.app_role)
        ? await commitRestrictiveUserAccess(admin, { ...input, operation: "demote" })
        : await commitExpansiveUserAccess(admin, { ...input, operation: "promote" });
    } else if (updates.is_active === false) {
      accessResult = await commitRestrictiveUserAccess(admin, {
        targetUserId: id, actingUserId: actor.id, organizationId: actor.organization_id,
        operation: "disable", requestKey: request.headers.get("idempotency-key"),
      });
    }
  } catch (error) {
    logError("admin.users.update", error, { action: "lifecycle_command", targetUserId: id });
    return NextResponse.json({ error: "Account access command could not complete. Refresh account status before retrying." }, { status: 409 });
  }
  if (accessResult && accessResult.sync_status !== "synchronized") {
    return NextResponse.json({ data: accessResult, sync_status: accessResult.sync_status,
      error: "Account synchronization is pending. Restrictive changes are already effective; expansions remain pending." }, { status: 202 });
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.full_name !== undefined) updatePayload.full_name = updates.full_name;
  if (updates.phone !== undefined) updatePayload.phone = updates.phone;
  if (updates.email !== undefined) updatePayload.email = updates.email;
  if (updates.job_title !== undefined) updatePayload.job_title = updates.job_title;
  if (updates.avatar_url !== undefined) updatePayload.avatar_url = updates.avatar_url;
  if (updates.manager_user_id !== undefined) updatePayload.manager_user_id = updates.manager_user_id;

  const hasProfileFields = Object.keys(updatePayload).length > 1;
  if (!hasProfileFields) {
    return NextResponse.json({ data: accessResult ?? target, changes: { before: target, after: accessResult ?? target } });
  }

  const { data: updated, error: updateErr } = await admin
    .from("user_profiles")
    .update(updatePayload)
    .eq("id", id)
    .eq("organization_id", actor.organization_id!)
    .select()
    .single();
  if (updateErr || !updated) {
    return NextResponse.json({ error: "Profile update failed; account access may already have changed. Retry this update.", sync_status: "retry_required" }, { status: 500 });
  }

  // Access commands already carry their audit row in the database transaction;
  // ordinary profile fields remain a separate, non-authority audit.
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId: id,
    action: "update_profile",
    changes: { before: target, after: updated },
  });

  return NextResponse.json({
    data: updated,
    changes: { before: target, after: updated },
  });
}

// ── DELETE: Soft-Delete User ──────────────────────────────────────

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "manager"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { id } = await ctx.params;
  if (actor.id === id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 422 });
  }

  const admin = actor.admin;

  // Fetch target
  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role, is_active")
    .eq("id", id)
    .eq("organization_id", actor.organization_id!)
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canManageUser(actor.app_role, target.app_role)) {
    return NextResponse.json({ error: "Cannot delete this user" }, { status: 403 });
  }

  // Optional reason
  let reason: string | undefined;
  try {
    const body = await request.json();
    const parsed = deleteUserSchema.safeParse(body);
    if (parsed.success) reason = parsed.data.reason;
  } catch {
    // No body or invalid — reason is optional
  }

  try {
    const result = await commitRestrictiveUserAccess(admin, {
      targetUserId: id, actingUserId: actor.id, organizationId: actor.organization_id,
      operation: "soft_delete", reason, requestKey: request.headers.get("idempotency-key"),
    });
    if (result.sync_status !== "synchronized") {
      return NextResponse.json({ data: result, sync_status: result.sync_status }, { status: 202 });
    }
  } catch (error) {
    logError("admin.users.delete", error, { action: "lifecycle_command", targetUserId: id });
    return NextResponse.json({ error: "Account deletion could not complete. Refresh account status before retrying." }, { status: 409 });
  }

  return new NextResponse(null, { status: 204 });
}
