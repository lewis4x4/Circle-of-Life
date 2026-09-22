import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Claim / release an On-tap row (COL-593). Kept apart from the feed reader so
 * the client bundle carries no schema library: the database answers with a
 * flat object and the page refreshes from the server afterwards.
 */
export async function claimHomeTask(
  supabase: SupabaseClient<Database>,
  instanceId: string,
  claim: boolean,
): Promise<{ assignedTo: string | null; assignedAt: string | null }> {
  const { data, error } = await supabase.rpc("home_claim_task", { p_instance_id: instanceId, p_claim: claim });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { assignedTo?: string | null; assignedAt?: string | null };
  return { assignedTo: result.assignedTo ?? null, assignedAt: result.assignedAt ?? null };
}
