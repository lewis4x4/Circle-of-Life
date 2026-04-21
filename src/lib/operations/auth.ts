import { NextResponse } from "next/server";

import type { AppRole } from "@/lib/rbac";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { createClient } from "@/lib/supabase/server";
import { OPERATIONS_MUTATION_ADMIN_ROLE_SET, OPERATIONS_VIEW_ROLE_SET, ORG_WIDE_OPERATION_ROLES } from "@/lib/operations/constants";

type AdminClient = ReturnType<typeof createServiceRoleClient>;

type OperationsProfileRow = {
  id: string;
  organization_id: string | null;
  app_role: AppRole | null;
  is_active: boolean | null;
};

export type OperationsActor = {
  id: string;
  organizationId: string;
  appRole: AppRole;
  admin: AdminClient;
};

type OperationTaskAccessShape = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
};

export async function requireOperationsActor(): Promise<
  { actor: OperationsActor } | { response: NextResponse }
> {
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
    .select("id, organization_id, app_role, is_active")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  const actor = profile as OperationsProfileRow | null;
  if (profileError || !actor?.organization_id || !actor.app_role || actor.is_active === false) {
    return {
      response: NextResponse.json({ error: "Profile not found" }, { status: 403 }),
    };
  }

  return {
    actor: {
      id: actor.id,
      organizationId: actor.organization_id,
      appRole: actor.app_role,
      admin,
    },
  };
}

export function actorCanViewOperations(actor: Pick<OperationsActor, "appRole">) {
  return OPERATIONS_VIEW_ROLE_SET.has(actor.appRole);
}

export function actorHasMutationAdminScope(actor: Pick<OperationsActor, "appRole">) {
  return OPERATIONS_MUTATION_ADMIN_ROLE_SET.has(actor.appRole);
}

export async function listActorAccessibleFacilityIds(actor: OperationsActor): Promise<string[]> {
  if (ORG_WIDE_OPERATION_ROLES.has(actor.appRole)) {
    const { data } = await actor.admin
      .from("facilities")
      .select("id")
      .eq("organization_id", actor.organizationId)
      .eq("status", "active")
      .is("deleted_at", null);

    return Array.from(new Set((data ?? []).map((facility) => facility.id)));
  }

  const { data } = await actor.admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", actor.id)
    .eq("organization_id", actor.organizationId)
    .is("revoked_at", null);

  return Array.from(new Set((data ?? []).map((row) => row.facility_id)));
}

export async function actorCanAccessFacility(actor: OperationsActor, facilityId: string) {
  return serviceRoleUserHasFacilityAccess(actor.admin, {
    userId: actor.id,
    facilityId,
    organizationId: actor.organizationId,
    appRole: actor.appRole,
  });
}

export async function actorCanMutateTask(
  actor: OperationsActor,
  task: OperationTaskAccessShape,
): Promise<boolean> {
  if (task.organization_id !== actor.organizationId) return false;
  if (task.assigned_to === actor.id) return true;
  if (!actorHasMutationAdminScope(actor)) return false;
  return actorCanAccessFacility(actor, task.facility_id);
}
