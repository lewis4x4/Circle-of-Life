import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
  type CurrentApiActorResult,
} from "@/lib/auth/current-api-actor";
import type { AppRole } from "@/lib/rbac";
import { intakeFailure } from "./http";

/** Union of the organization-setting roles (upload / review / custodian); the RPCs enforce the finer rules. */
export const DOCUMENT_INTAKE_API_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
] as const satisfies readonly AppRole[];

/** Who may open a resident's filed documents from the resident record. */
export const RESIDENT_DOCUMENT_ROLES = [...DOCUMENT_INTAKE_API_ROLES, "med_tech"] as const satisfies readonly AppRole[];

export function requireDocumentIntakeActor(allowedRoles: readonly AppRole[] = DOCUMENT_INTAKE_API_ROLES): Promise<CurrentApiActorResult> {
  return requireCurrentApiActor({ allowedRoles, scope: "document-intake.current-actor" });
}

/** Fresh session + profile check right before a person RPC that changes state. */
export async function revalidateDocumentIntakeActor(
  actor: CurrentApiActor,
  allowedRoles: readonly AppRole[] = DOCUMENT_INTAKE_API_ROLES,
): Promise<CurrentApiActorResult> {
  const result = await revalidateCurrentApiActor(actor, { allowedRoles, scope: "document-intake.current-actor.revalidate" });
  if ("response" in result) return result;
  if (result.actor.id !== actor.id || result.actor.organizationId !== actor.organizationId || result.actor.appRole !== actor.appRole) {
    return { response: intakeFailure(403, "forbidden", "Your access changed; sign in again to continue") };
  }
  return result;
}
