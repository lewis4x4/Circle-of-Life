import { NextResponse } from "next/server";

import type { AppRole } from "@/lib/rbac";
import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
} from "@/lib/auth/current-api-actor";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { OPERATIONS_MUTATION_ADMIN_ROLE_SET, OPERATIONS_VIEW_ROLE_SET, ORG_WIDE_OPERATION_ROLES } from "@/lib/operations/constants";

type AdminClient = ReturnType<typeof createServiceRoleClient>;

export type OperationsActor = {
  id: string;
  organizationId: string;
  appRole: AppRole;
  admin: AdminClient;
  currentActor: CurrentApiActor;
};

type OperationTaskAccessShape = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  assigned_role?: string | null;
};

export async function requireOperationsActor(): Promise<
  { actor: OperationsActor } | { response: NextResponse }
> {
  const result = await requireCurrentApiActor({ scope: "operations.api-auth" });
  if ("response" in result) return result;

  return {
    actor: {
      id: result.actor.id,
      organizationId: result.actor.organizationId,
      appRole: result.actor.appRole,
      admin: result.actor.admin,
      currentActor: result.actor,
    },
  };
}

export async function revalidateOperationsActor(
  actor: OperationsActor,
): Promise<{ actor: OperationsActor } | { response: NextResponse }> {
  const result = await revalidateCurrentApiActor(actor.currentActor, {
    scope: "operations.api-auth.revalidate",
  });
  if ("response" in result) return result;
  return {
    actor: {
      id: result.actor.id,
      organizationId: result.actor.organizationId,
      appRole: result.actor.appRole,
      admin: result.actor.admin,
      currentActor: result.actor,
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
  });
}

export async function actorCanMutateTask(
  actor: OperationsActor,
  task: OperationTaskAccessShape,
): Promise<boolean> {
  if (task.organization_id !== actor.organizationId) return false;
  if (task.assigned_to === actor.id || (!task.assigned_to && task.assigned_role === actor.appRole)) return actorCanAccessFacility(actor, task.facility_id);
  if (!actorHasMutationAdminScope(actor)) return false;
  return actorCanAccessFacility(actor, task.facility_id);
}
