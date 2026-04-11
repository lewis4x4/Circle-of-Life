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
import { canManageUser } from "@/lib/rbac";
import type { Database } from "@/types/database";
import { updateUserSchema, deleteUserSchema } from "@/lib/validation/user-management";
import { adminUpdateUserRole, adminDisableUser } from "@/lib/supabase/admin-client";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";

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
>;

type UserUpdateTargetRow = Pick<
  Database["public"]["Tables"]["user_profiles"]["Row"],
  "id" | "organization_id" | "email" | "full_name" | "phone" | "app_role" | "job_title" | "is_active" | "manager_user_id"
>;

type UserFacilityAccessDetailRow = Pick<
  Database["public"]["Tables"]["user_facility_access"]["Row"],
  "id" | "facility_id" | "is_primary" | "granted_at" | "granted_by" | "revoked_at" | "revoked_by"
> & {
  facilities: { name: string | null } | null;
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
    .select("id, organization_id, email, full_name, phone, app_role, job_title, avatar_url, is_active, last_login_at, manager_user_id, created_at, updated_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  const profile = profileResult.data as UserDetailRow | null;
  const error = profileResult.error;
  if (error || !profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (profile.organization_id !== actor.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Facility access
  const facilitiesResult = await admin
    .from("user_facility_access")
    .select("id, facility_id, is_primary, granted_at, granted_by, revoked_at, revoked_by, facilities(name)")
    .eq("user_id", id)
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
  if (!(await actorCanAccessTargetUser(actor, id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

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

  const admin = actor.admin;

  // Fetch target — new columns not yet in generated types
  const targetResult = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, phone, app_role, job_title, is_active, manager_user_id")
    .eq("id", id)
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
  if (updates.app_role !== undefined && updates.app_role !== target.app_role) {
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

  // Email uniqueness check if changing email
  if (updates.email && updates.email !== target.email) {
    const { data: existing } = await admin
      .from("user_profiles")
      .select("id")
      .eq("email", updates.email)
      .neq("id", id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.full_name !== undefined) updatePayload.full_name = updates.full_name;
  if (updates.phone !== undefined) updatePayload.phone = updates.phone;
  if (updates.email !== undefined) updatePayload.email = updates.email;
  if (updates.job_title !== undefined) updatePayload.job_title = updates.job_title;
  if (updates.avatar_url !== undefined) updatePayload.avatar_url = updates.avatar_url;
  if (updates.is_active !== undefined) updatePayload.is_active = updates.is_active;
  if (updates.manager_user_id !== undefined) updatePayload.manager_user_id = updates.manager_user_id;
  if (updates.app_role !== undefined) updatePayload.app_role = updates.app_role;

  const { data: updated, error: updateErr } = await admin
    .from("user_profiles")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();
  if (updateErr) {
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }

  // Sync role to auth if changed
  const auditAction = updates.app_role && updates.app_role !== target.app_role ? "update_role" : "update_profile";
  if (updates.app_role && updates.app_role !== target.app_role) {
    try {
      await adminUpdateUserRole(id, updates.app_role);
    } catch (err) {
      console.error("[user-update] Failed to sync role to auth:", err);
    }
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId: id,
    action: auditAction,
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
  if (!(await actorCanAccessTargetUser(actor, id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const admin = actor.admin;

  // Fetch target
  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role, is_active")
    .eq("id", id)
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

  const now = new Date().toISOString();

  // Soft-delete profile
  await admin
    .from("user_profiles")
    .update({ deleted_at: now, is_active: false, updated_at: now })
    .eq("id", id);

  // Revoke all facility access
  await admin
    .from("user_facility_access")
    .update({ revoked_at: now, revoked_by: actor.id })
    .eq("user_id", id)
    .is("revoked_at", null);

  // Disable auth account
  try {
    await adminDisableUser(id);
  } catch (err) {
    console.error("[user-delete] Failed to disable auth:", err);
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId: id,
    action: "soft_delete",
    changes: { before: { is_active: target.is_active, app_role: target.app_role }, after: { is_active: false, deleted_at: now } },
    reason,
  });

  return new NextResponse(null, { status: 204 });
}
