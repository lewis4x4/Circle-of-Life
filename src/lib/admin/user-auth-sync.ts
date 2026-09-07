import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";

type AdminClient = SupabaseClient<Database>;
export type UserAuthSyncJob = {
  id: string;
  target_user_id: string;
  organization_id: string;
  desired_app_role: Database["public"]["Enums"]["app_role"];
  desired_claim_version: number;
  direction: "restrictive" | "expansive";
  operation: string;
  should_ban: boolean;
  phase: "pending_auth" | "auth_succeeded" | "finalized" | "dead_letter";
  lease_token: string;
  allow_unban?: boolean;
};

export async function lifecycleRpc<T>(admin: AdminClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

/** A lease fences database writes; current profile/version guards all usable authority.
 * Every retry repeats the idempotent Auth update because a crash may precede its receipt.
 * Expansions recheck both actor and exact target version before AND after that update.
 */
export async function processUserAuthSyncJob(admin: AdminClient, jobId?: string): Promise<UserAuthSyncJob | null> {
  const job = await lifecycleRpc<UserAuthSyncJob | null>(admin, "claim_user_auth_sync_job", {
    p_job_id: jobId ?? null, p_lease_seconds: 300,
  });
  if (!job) return null;
  try {
    await lifecycleRpc(admin, "validate_user_auth_sync_job", { p_job_id: job.id, p_lease_token: job.lease_token });
    await lifecycleRpc(admin, "request_user_auth_reconciliation", { p_job_id: job.id });
    const changesBan = job.should_ban || job.operation === "reactivate" || (job.operation === "reconcile" && job.allow_unban);
    const { error } = await admin.auth.admin.updateUserById(job.target_user_id, {
      app_metadata: {
        app_role: job.desired_app_role,
        organization_id: job.organization_id,
        auth_claim_version: job.desired_claim_version,
        haven_auth_sync_job_id: job.id,
        ...(changesBan ? { haven_auth_ban_job_id: job.id, haven_auth_ban_version: job.desired_claim_version } : {}),
      },
      // Preserve independent security holds. Only explicit reactivation or a
      // database-proven obsolete own ban may unban a previously banned identity.
      ...(job.should_ban ? { ban_duration: "876000h" } :
        job.operation === "reactivate" || (job.operation === "reconcile" && job.allow_unban)
          ? { ban_duration: "0s" } : {}),
    });
    if (error) throw error;
    await lifecycleRpc(admin, "validate_user_auth_sync_job", { p_job_id: job.id, p_lease_token: job.lease_token });
    await lifecycleRpc(admin, "mark_user_auth_sync_succeeded", { p_job_id: job.id, p_lease_token: job.lease_token });
    return await lifecycleRpc<UserAuthSyncJob>(admin, "finalize_user_auth_sync_job", {
      p_job_id: job.id, p_lease_token: job.lease_token,
    });
  } catch (error) {
    // Store only a bounded code, never provider error bodies containing identities.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "auth_sync_failed";
    // This is deliberately NOT lease-fenced: an expired worker can still have
    // completed a remote write, and must request current-state repair.
    await lifecycleRpc(admin, "request_user_auth_reconciliation", { p_job_id: job.id });
    await lifecycleRpc(admin, "fail_user_auth_sync_job", {
      p_job_id: job.id, p_lease_token: job.lease_token, p_error_code: code,
    });
    return { ...job, phase: code === "40001" || code === "42501" ? "dead_letter" : job.phase };
  }
}

export async function drainUserAuthSyncJobs(admin: AdminClient, limit = 10) {
  await lifecycleRpc(admin, "reconcile_user_auth_sync_targets", { p_limit: 20 });
  const counts = { processed: 0, finalized: 0, retryRequired: 0 };
  for (let index = 0; index < limit; index++) {
    const job = await processUserAuthSyncJob(admin);
    if (!job) break;
    counts.processed++;
    if (job.phase === "finalized") counts.finalized++;
    else counts.retryRequired++;
  }
  return counts;
}
