import { NextResponse } from "next/server";

import { ADMIN_ELIGIBLE_ROLES, type AppRole } from "@/lib/rbac";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type AdminClient = ReturnType<typeof createServiceRoleClient>;

type AdminProfileRow = {
  id: string;
  organization_id: string | null;
  app_role: AppRole | null;
};

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
  const supabase = await createClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return {
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const admin = createServiceRoleClient();
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  const actor = profile as AdminProfileRow | null;
  if (profileError || !actor?.organization_id || !actor.app_role) {
    return {
      response: NextResponse.json({ error: "Profile not found" }, { status: 403 }),
    };
  }

  const allowedRoles = options?.allowedRoles
    ? new Set<AppRole>(options.allowedRoles)
    : new Set<AppRole>(Array.from(ADMIN_ELIGIBLE_ROLES) as AppRole[]);

  if (!allowedRoles.has(actor.app_role)) {
    return {
      response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }),
    };
  }

  return {
    actor: {
      id: actor.id,
      organization_id: actor.organization_id,
      app_role: actor.app_role,
      admin,
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
    appRole: actor.app_role,
  });
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

  const { data } = await actor.admin
    .from("user_facility_access")
    .select("user_id")
    .eq("user_id", targetUserId)
    .in("facility_id", facilityIds)
    .is("revoked_at", null)
    .maybeSingle();

  return Boolean(data);
}
