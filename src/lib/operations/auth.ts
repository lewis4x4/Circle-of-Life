import { NextResponse } from "next/server";

import type { AppRole } from "@/lib/rbac";
import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
} from "@/lib/auth/current-api-actor";
import { OPERATIONS_MUTATION_ADMIN_ROLE_SET, OPERATIONS_VIEW_ROLE_SET } from "@/lib/operations/constants";

export type OperationsActor = {
  id: string;
  organizationId: string;
  appRole: AppRole;
  currentActor: CurrentApiActor;
};

type OperationTaskAccessShape = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  assigned_role?: string | null;
};

export async function requireOperationsActor(options?: { allowedRoles?: readonly AppRole[] }): Promise<
  { actor: OperationsActor } | { response: NextResponse }
> {
  const result = await requireCurrentApiActor({ scope: "operations.api-auth", allowedRoles: options?.allowedRoles });
  if ("response" in result) return result;

  return {
    actor: {
      id: result.actor.id,
      organizationId: result.actor.organizationId,
      appRole: result.actor.appRole,
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

/** Current database grants, including explicit corporate coverage, govern every request. */
export async function listActorAccessibleFacilityIds(actor: OperationsActor): Promise<string[]> {
  const { data, error } = await actor.currentActor.client.rpc("haven_operation_accessible_facility_ids" as never);
  if (error || !Array.isArray(data)) throw new Error("Could not verify facility access");
  return Array.from(new Set(data as string[]));
}

export async function actorCanAccessFacility(actor: OperationsActor, facilityId: string) {
  const { data, error } = await actor.currentActor.client.rpc(
    "haven_operation_facility_access" as never,
    { p_facility_id: facilityId } as never,
  );
  return !error && data === true;
}

export async function actorCanMutateTask(
  actor: OperationsActor,
  task: OperationTaskAccessShape,
): Promise<boolean> {
  if (task.organization_id !== actor.organizationId) return false;
  const { data, error } = await actor.currentActor.client.rpc(
    "haven_operation_task_access" as never,
    { p_task_id: task.id } as never,
  );
  return !error && data === true;
}
