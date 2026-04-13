/**
 * Audit logging helper for user management operations.
 * Server-only — uses service role client.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

type AuditAction =
  | "create"
  | "update_profile"
  | "update_role"
  | "grant_access"
  | "revoke_access"
  | "soft_delete"
  | "reactivate";

interface WriteAuditParams {
  organizationId: string;
  actingUserId: string;
  targetUserId: string;
  action: AuditAction;
  resourceType?: string;
  changes: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  reason?: string;
}

type UserManagementAuditInsert = Database["public"]["Tables"]["user_management_audit_log"]["Insert"];
type DatabaseJson = Database["public"]["Tables"]["user_management_audit_log"]["Row"]["changes"];

export async function writeUserAuditEntry(params: WriteAuditParams): Promise<void> {
  const supabase = createServiceRoleClient();
  const payload: UserManagementAuditInsert = {
    organization_id: params.organizationId,
    acting_user_id: params.actingUserId,
    target_user_id: params.targetUserId,
    action: params.action,
    resource_type: params.resourceType ?? "user",
    changes: params.changes as DatabaseJson,
    reason: params.reason ?? null,
  };

  const { error } = await supabase.from("user_management_audit_log").insert(payload);

  if (error) {
    // Log but don't throw — audit failure shouldn't block the operation
    console.error("[user-audit] Failed to write audit entry:", error.message);
  }
}
