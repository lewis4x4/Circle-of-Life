import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type NextActionTerms = { action_text: string; owner_id: string; backup_id: string | null; due_at: string | null; waiting_condition: string | null; dependency_text: string | null };
export type NextActionView = NextActionTerms & {
  id: string; organization_id: string; facility_id: string; lead_id: string; lead_name: string;
  status: "open" | "completed" | "superseded"; version: number; terms_version: number;
  owner_name: string; backup_name: string | null; owner_eligible: boolean; backup_eligible: boolean;
  owner_acknowledged: boolean; backup_accepted: boolean; can_manage: boolean; can_acknowledge: boolean; can_accept_backup: boolean; can_complete: boolean;
  owner_acknowledged_at: string | null; owner_acknowledged_version: number | null; backup_accepted_at: string | null; backup_accepted_version: number | null;
  completed_at: string | null; completed_by: string | null; completion_evidence: string | null; superseded_by_action_id: string | null;
  created_at: string; created_by: string; updated_at: string;
};
export type NextActionRecord = Omit<NextActionView, "lead_name" | "owner_name" | "backup_name" | "owner_eligible" | "backup_eligible" | "owner_acknowledged" | "backup_accepted" | "can_manage" | "can_acknowledge" | "can_accept_backup" | "can_complete">;
export type NextActionCursor = { created_at: string; id: string };
export type NextActionEvent = { id: string; request_id: string; action_id: string; lead_id: string; command: string; actor_id: string; actor_name: string; created_at: string; payload: Record<string, unknown>; before_state: NextActionRecord | null; after_state: NextActionRecord };
export type NextActionAssignee = { id: string; full_name: string; app_role: string };
export type NextActionResult = { request_id: string; action: NextActionView; previous_action?: NextActionView };
export type NextActionCommand = "create" | "update" | "acknowledge" | "accept_backup" | "complete" | "supersede";
type Client = SupabaseClient<Database>;
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name as never, args as never);
  if (error) throw error;
  return data as unknown as T;
}
export function listReferralNextActions(client: Client, facilityId: string, options: { leadId?: string; openOnly?: boolean; cursor?: NextActionCursor | null; limit?: number } = {}) {
  return call<{ items: NextActionView[]; next_cursor: NextActionCursor | null }>(client, "haven_list_referral_next_actions", { p_facility_id: facilityId, p_lead_id: options.leadId ?? null, p_open_only: options.openOnly ?? true, p_before_created_at: options.cursor?.created_at ?? null, p_before_id: options.cursor?.id ?? null, p_limit: options.limit ?? 25 });
}
export function listReferralNextActionEvents(client: Client, leadId: string, cursor: NextActionCursor | null = null) {
  return call<{ items: NextActionEvent[]; next_cursor: NextActionCursor | null }>(client, "haven_list_referral_next_action_events", { p_lead_id: leadId, p_action_id: null, p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null, p_limit: 25 });
}
export function listReferralNextActionAssignees(client: Client, facilityId: string, cursor: string | null = null) {
  return call<{ items: NextActionAssignee[]; next_cursor: string | null }>(client, "haven_list_referral_next_action_assignees", { p_facility_id: facilityId, p_after_user_id: cursor, p_limit: 50 });
}
export function commandReferralNextAction(client: Client, requestId: string, leadId: string, action: NextActionView | null, command: NextActionCommand, payload: Record<string, unknown>) {
  return call<NextActionResult>(client, "haven_command_referral_next_action", { p_request_id: requestId, p_lead_id: leadId, p_action_id: action?.id ?? null, p_expected_version: action?.version ?? 0, p_command: command, p_payload: payload });
}
export function getReferralNextActionReceipt(client: Client, requestId: string, leadId: string) {
  return call<NextActionResult | null>(client, "haven_get_referral_next_action_receipt", { p_request_id: requestId, p_lead_id: leadId });
}
export type RecoveryScope = { user_id: string; organization_id: string; facility_id: string; lead_id: string };
export type RecoveryIdentifier = RecoveryScope & { request_id: string; action_id: string | null };
export function recoveryKey(scope: RecoveryScope) { return `haven:referral-next-action:${scope.user_id}:${scope.organization_id}:${scope.facility_id}:${scope.lead_id}`; }
const recoveryScopeKeys = ["user_id", "organization_id", "facility_id", "lead_id"] as const;
export function readRecoveryIdentifiers(storage: Pick<Storage, "getItem">, scope: RecoveryScope): RecoveryIdentifier[] {
  const raw = storage.getItem(recoveryKey(scope));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Recovery identifier is invalid.");
    const value = entry as Record<string, unknown>;
    if (typeof value.request_id !== "string" || !value.request_id
      || (value.action_id != null && typeof value.action_id !== "string")
      || !recoveryScopeKeys.every((key) => value[key] === scope[key])) throw new Error("Recovery identifier is invalid.");
    return { user_id: scope.user_id, organization_id: scope.organization_id, facility_id: scope.facility_id, lead_id: scope.lead_id, request_id: value.request_id, action_id: (value.action_id as string | null) ?? null };
  });
}
export function saveRecoveryIdentifier(storage: Pick<Storage, "getItem" | "setItem">, scope: RecoveryScope, requestId: string, actionId: string | null) {
  // Retain older uncertain attempts; a missing receipt can still be an in-flight transaction.
  // Explicit allowlist: never persist payloads, names, or draft text.
  const entries = readRecoveryIdentifiers(storage, scope);
  if (!entries.some((entry) => entry.request_id === requestId)) entries.push({ user_id: scope.user_id, organization_id: scope.organization_id, facility_id: scope.facility_id, lead_id: scope.lead_id, request_id: requestId, action_id: actionId });
  storage.setItem(recoveryKey(scope), JSON.stringify(entries));
}
export function removeRecoveryIdentifier(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, scope: RecoveryScope, requestId: string) {
  const remaining = readRecoveryIdentifiers(storage, scope).filter((entry) => entry.request_id !== requestId);
  if (remaining.length) storage.setItem(recoveryKey(scope), JSON.stringify(remaining));
  else storage.removeItem(recoveryKey(scope));
}

/** SQL rejection proves this command transaction did not commit; transport errors do not. */
export function referralActionRejection(error: unknown): string | null {
  const code = error != null && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "PT409" || code === "40001" || code === "23505") return "The action changed or another open action already exists. Your draft is retained; refresh and review current work before starting a new draft.";
  if (code === "42501") return "Current access does not allow this change. Your draft is retained; refresh to check access and current work.";
  if (["22023", "23514", "22P02"].includes(String(code))) return "The action was not saved. Review the required fields and current action; your draft is retained.";
  if (code === "55000") return "The action is no longer available for this change. Your draft is retained; refresh and review current work.";
  return null;
}
