import { NextResponse } from "next/server";

import { ADMIN_ELIGIBLE_ROLES, type AppRole } from "@/lib/rbac";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type AdminClient = ReturnType<typeof createServiceRoleClient>;

export type AdminApiActor = {
  id: string;
  organization_id: string;
  app_role: AppRole;
  admin: AdminClient;
};

type RequireAdminApiActorResult =
  | { actor: AdminApiActor }
  | { response: NextResponse };

const ORG_WIDE_ROLES = new Set<AppRole>(["owner", "org_admin"]);

export async function requireAdminApiActor(options?: {
  allowedRoles?: readonly AppRole[];
}): Promise<RequireAdminApiActorResult> {
  const allowedRoles = options?.allowedRoles
    ? options.allowedRoles
    : (Array.from(ADMIN_ELIGIBLE_ROLES) as AppRole[]);
  const result = await requireCurrentApiActor({
    allowedRoles,
    scope: "admin.api-auth",
  });
  if ("response" in result) return result;

  return {
    actor: {
      id: result.actor.id,
      organization_id: result.actor.organizationId,
      app_role: result.actor.appRole,
      admin: result.actor.admin,
    },
  };
}

export function actorHasOrgWideFacilityScope(actor: Pick<AdminApiActor, "app_role">) {
  return ORG_WIDE_ROLES.has(actor.app_role);
}

export async function listActorAccessibleFacilityIds(actor: AdminApiActor): Promise<string[]> {
  if (actorHasOrgWideFacilityScope(actor)) {
    const { data } = await actor.admin
      .from("facilities")
      .select("id")
      .eq("organization_id", actor.organization_id)
      .is("deleted_at", null);

    return Array.from(new Set((data ?? []).map((facility) => facility.id)));
  }

  const { data } = await actor.admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", actor.id)
    .eq("organization_id", actor.organization_id)
    .is("revoked_at", null);

  return Array.from(new Set((data ?? []).map((row) => row.facility_id)));
}

export async function actorCanAccessFacility(actor: AdminApiActor, facilityId: string) {
  return serviceRoleUserHasFacilityAccess(actor.admin, {
    userId: actor.id,
    facilityId,
    organizationId: actor.organization_id,
  });
}

/** Shared service-role guard: 404 when the actor cannot see the facility. */
export async function requireFacilityAccess(
  actor: AdminApiActor,
  facilityId: string,
): Promise<{ ok: true } | { response: NextResponse }> {
  const allowed = await actorCanAccessFacility(actor, facilityId);
  if (!allowed) {
    return {
      response: NextResponse.json({ error: "Facility not found" }, { status: 404 }),
    };
  }
  return { ok: true };
}

export async function actorCanAccessTargetUser(actor: AdminApiActor, targetUserId: string) {
  if (actorHasOrgWideFacilityScope(actor)) {
    const { data } = await actor.admin
      .from("user_profiles")
      .select("id")
      .eq("id", targetUserId)
      .eq("organization_id", actor.organization_id)
      .maybeSingle();

    return Boolean(data);
  }

  const facilityIds = await listActorAccessibleFacilityIds(actor);
  if (facilityIds.length === 0) {
    return false;
  }

  const { data, error } = await actor.admin
    .from("user_facility_access")
    .select("user_id")
    .eq("user_id", targetUserId)
    .in("facility_id", facilityIds)
    .eq("organization_id", actor.organization_id)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  return !error && Boolean(data);
}
