import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { lifecycleRpc, processUserAuthSyncJob, type UserAuthSyncJob } from "./user-auth-sync";

type AdminClient = SupabaseClient<Database>;
export type RestrictiveUserOperation = "disable" | "soft_delete" | "hard_delete" | "demote" | "revoke_facility";
export type ExpansiveUserOperation = "promote" | "reactivate" | "grant_facility";
type AccessInput = {
  targetUserId: string; actingUserId: string; organizationId: string;
  desiredRole?: Database["public"]["Enums"]["app_role"];
  reason?: string;
  requestKey?: string | null;
};
export type UserAccessCommandResult = {
  target_user_id: string;
  job_id: string;
  sync_status: "synchronized" | "retry_required" | "action_required";
  app_role: Database["public"]["Enums"]["app_role"];
  organization_id: string;
  auth_claim_version: number;
};

async function command(admin: AdminClient, input: AccessInput, name: string, args: Record<string, unknown>): Promise<UserAccessCommandResult> {
  // Resolve signed session and current version via the request client, never via
  // a caller-provided session, decoded unverified JWT, or service-role lookup.
  const client = await createClient();
  const { data, error } = await client.rpc("haven_current_edge_actor" as never);
  const actor = data as { user_id: string; organization_id: string; session_id: string; auth_claim_version: number } | null;
  if (error || !actor || actor.user_id !== input.actingUserId || actor.organization_id !== input.organizationId || !actor.session_id) {
    throw new Error("Current lifecycle authorization is unavailable");
  }
  const job = await lifecycleRpc<UserAuthSyncJob>(admin, name, {
    p_target_user_id: input.targetUserId, p_acting_user_id: input.actingUserId,
    p_actor_session_id: actor.session_id, p_actor_claim_version: actor.auth_claim_version,
    p_organization_id: input.organizationId,
    p_request_key: input.requestKey ?? randomUUID(),
    p_desired_role: input.desiredRole ?? null, p_reason: input.reason ?? null, ...args,
  });
  const completed = job.phase === "finalized" || job.phase === "dead_letter" ? job :
    await processUserAuthSyncJob(admin, job.id) ?? job;
  const observed = completed.phase === "finalized" ? await lifecycleRpc<{ phase: string } | null>(admin,
    "user_auth_sync_status_review", { p_target_user_id: job.target_user_id, p_organization_id: job.organization_id }) : null;
  return {
    target_user_id: job.target_user_id, job_id: job.id,
    sync_status: completed.phase === "finalized" && observed?.phase === "finalized" ? "synchronized" :
      (completed.phase === "dead_letter" || observed?.phase === "dead_letter") ? "action_required" : "retry_required",
    app_role: job.desired_app_role, organization_id: job.organization_id,
    auth_claim_version: job.desired_claim_version,
  };
}

export function commitRestrictiveUserAccess(admin: AdminClient, input: AccessInput & {
  operation: RestrictiveUserOperation; facilityId?: string;
}) {
  return command(admin, input, "restrict_user_access_review", {
    p_operation: input.operation, p_facility_id: input.facilityId ?? null,
  });
}

export function commitExpansiveUserAccess(admin: AdminClient, input: AccessInput & {
  operation: ExpansiveUserOperation; facilityIds?: string[]; primaryFacilityId?: string;
}) {
  return command(admin, input, "prepare_user_access_expansion_review", {
    p_operation: input.operation, p_facility_ids: input.facilityIds ?? [],
    p_primary_facility_id: input.primaryFacilityId ?? null,
  });
}
