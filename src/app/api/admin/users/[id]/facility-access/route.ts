/**
 * POST   /api/admin/users/[id]/facility-access              — Grant facility access
 * DELETE /api/admin/users/[id]/facility-access/[facilityId] — Revoke facility access
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canManageUser } from "@/lib/rbac";
import { grantFacilityAccessSchema } from "@/lib/validation/user-management";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";

interface RouteContext {
  params: Promise<{ id: string; facilityId?: string }>;
}

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return profile ? { ...profile, admin } : null;
}

// ── POST: Grant Facility Access ───────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id: targetUserId } = await ctx.params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = grantFacilityAccessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { facility_id, is_primary } = parsed.data;

  const admin = actor.admin;

  // Verify target user exists and belongs to same org
  const { data: target } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", targetUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!target || target.organization_id !== actor.organization_id!) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Actor must be able to manage target
  const grantRoles = new Set(["owner", "org_admin", "facility_admin", "manager"]);
  if (!grantRoles.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Verify facility belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, name")
    .eq("id", facility_id)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Check for existing access
  const { data: existing } = await admin
    .from("user_facility_access")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("facility_id", facility_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "User already has access to this facility" }, { status: 409 });
  }

  // If is_primary, clear previous primary
  if (is_primary) {
    await admin
      .from("user_facility_access")
      .update({ is_primary: false })
      .eq("user_id", targetUserId)
      .eq("is_primary", true)
      .is("revoked_at", null);
  }

  // Grant access
  const { data: accessRow, error: insertErr } = await admin
    .from("user_facility_access")
    .insert({
      user_id: targetUserId,
      facility_id,
      organization_id: actor.organization_id!,
      is_primary,
      granted_by: actor.id,
    })
    .select("id, facility_id, is_primary, granted_at, granted_by")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: "Failed to grant access" }, { status: 500 });
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId,
    action: "grant_access",
    resourceType: "facility_access",
    changes: { before: {}, after: { facility_id, is_primary } },
  });

  return NextResponse.json(
    {
      data: { ...accessRow, facility_name: facility.name },
    },
    { status: 201 },
  );
}

// ── DELETE: Revoke Facility Access ────────────────────────────────

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id: targetUserId, facilityId } = await ctx.params;
  if (!facilityId) {
    return NextResponse.json({ error: "Missing facility ID" }, { status: 400 });
  }

  const admin = actor.admin;

  const revokeRoles = new Set(["owner", "org_admin", "facility_admin", "manager"]);
  if (!revokeRoles.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Find the active access row
  const { data: accessRow } = await admin
    .from("user_facility_access")
    .select("id, user_id, facility_id, is_primary")
    .eq("user_id", targetUserId)
    .eq("facility_id", facilityId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!accessRow) {
    return NextResponse.json({ error: "Access grant not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Revoke
  await admin
    .from("user_facility_access")
    .update({ revoked_at: now, revoked_by: actor.id })
    .eq("id", accessRow.id);

  // If it was primary, promote the most recent other facility
  if (accessRow.is_primary) {
    const { data: otherAccess } = await admin
      .from("user_facility_access")
      .select("id")
      .eq("user_id", targetUserId)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (otherAccess) {
      await admin
        .from("user_facility_access")
        .update({ is_primary: true })
        .eq("id", otherAccess.id);
    }
  }

  // Check if user has any remaining facilities
  const { count } = await admin
    .from("user_facility_access")
    .select("id", { count: "exact" })
    .eq("user_id", targetUserId)
    .is("revoked_at", null);

  // If no facilities remain, soft-delete user
  if (count === 0) {
    await admin
      .from("user_profiles")
      .update({ is_active: false, deleted_at: now, updated_at: now })
      .eq("id", targetUserId);
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId,
    action: "revoke_access",
    resourceType: "facility_access",
    changes: { before: { facility_id: facilityId, is_primary: accessRow.is_primary }, after: { revoked_at: now } },
  });

  return new NextResponse(null, { status: 204 });
}
