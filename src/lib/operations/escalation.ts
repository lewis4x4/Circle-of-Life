import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { AppRole } from "@/lib/rbac";
import { OCE_ASSIGNEE_ROLE_CROSSWALK } from "@/lib/operations/constants";

type AdminClient = SupabaseClient<Database>;

export type EscalationStep = {
  role: string;
  sla_minutes: number;
  channel: "in_app" | "sms" | "voice";
  enabled: boolean;
};

export type OperationEscalationTask = {
  id: string;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  assigned_to: string | null;
  assigned_role: string | null;
  status: string;
  current_escalation_level: number | null;
  escalation_history: unknown;
  license_threatening: boolean | null;
  due_at: string | null;
};

export type EscalationResolution = {
  nextStep: EscalationStep | null;
  nextLevel: number;
  assignedUserId: string | null;
  assignedRole: string | null;
  assignedUserName: string | null;
  assignedUserPhone: string | null;
  nextDueAt: string | null;
  historyEntry: Record<string, unknown>;
};

type UserProfileRow = {
  id: string;
  app_role: AppRole;
  full_name: string | null;
  phone: string | null;
};

type UserFacilityAccessRow = {
  user_id: string;
  is_primary: boolean;
};

export function parseEscalationLadder(input: unknown): EscalationStep[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "",
      sla_minutes: typeof entry.sla_minutes === "number" ? entry.sla_minutes : 0,
      channel: (entry.channel === "voice" ? "voice" : entry.channel === "sms" ? "sms" : "in_app") as EscalationStep["channel"],
      enabled: entry.enabled !== false,
    }))
    .filter((entry) => entry.role && entry.sla_minutes >= 0 && entry.enabled);
}

export function computeNextDueAt(steps: EscalationStep[], nextIndex: number): string | null {
  const current = steps[nextIndex];
  if (!current) return null;
  const next = steps[nextIndex + 1];
  const minutes = next ? Math.max(5, next.sla_minutes - current.sla_minutes) : 5;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function normalizeEscalationHistory(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
}

export async function resolveEscalation(admin: AdminClient, args: {
  task: OperationEscalationTask;
  escalationLadder: EscalationStep[];
  reason: string;
  initiatedBy: string | null;
}) : Promise<EscalationResolution> {
  const currentLevel = args.task.current_escalation_level ?? 0;
  const nextIndex = currentLevel;
  const nextStep = args.escalationLadder[nextIndex] ?? null;
  const nextLevel = currentLevel + (nextStep ? 1 : 0);

  let assignedUserId: string | null = null;
  let assignedRole: string | null = nextStep?.role ?? args.task.assigned_role ?? null;
  let assignedUserName: string | null = null;
  let assignedUserPhone: string | null = null;

  if (nextStep?.role) {
    const crosswalk = OCE_ASSIGNEE_ROLE_CROSSWALK;
    const candidateRoles = (crosswalk as Record<string, AppRole[] | undefined>)[nextStep.role] ?? [];
    if (candidateRoles.length > 0) {
      const { data: userData } = await admin
        .from("user_profiles")
        .select("id, app_role, full_name, phone")
        .eq("organization_id", args.task.organization_id)
        .eq("is_active", true)
        .in("app_role", candidateRoles)
        .is("deleted_at", null);

      const users = (userData ?? []) as UserProfileRow[];
      if (users.length > 0) {
        const { data: accessData } = await admin
          .from("user_facility_access")
          .select("user_id, is_primary")
          .eq("organization_id", args.task.organization_id)
          .eq("facility_id", args.task.facility_id)
          .is("revoked_at", null)
          .in("user_id", users.map((user) => user.id));

        const facilityAccess = (accessData ?? []) as UserFacilityAccessRow[];
        const primaryUserIds = new Set(facilityAccess.filter((row) => row.is_primary).map((row) => row.user_id));
        const accessibleUserIds = new Set(facilityAccess.map((row) => row.user_id));
        const sortedUsers = users
          .filter((user) => accessibleUserIds.has(user.id) || user.app_role === "owner" || user.app_role === "org_admin")
          .sort((left, right) => {
            const leftPrimary = primaryUserIds.has(left.id) ? 0 : 1;
            const rightPrimary = primaryUserIds.has(right.id) ? 0 : 1;
            if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
            return (left.full_name || left.id).localeCompare(right.full_name || right.id);
          });
        const selected = sortedUsers[0] ?? null;
        if (selected) {
          assignedUserId = selected.id;
          assignedRole = selected.app_role;
          assignedUserName = selected.full_name;
          assignedUserPhone = selected.phone;
        }
      }
    }
  }

  const historyEntry = {
    escalated_at: new Date().toISOString(),
    escalated_to_role: nextStep?.role ?? "owner",
    assigned_role: assignedRole,
    assigned_user_id: assignedUserId,
    assigned_user_name: assignedUserName,
    channel: nextStep?.channel ?? "sms",
    reason: args.reason,
    initiated_by: args.initiatedBy,
  };

  return {
    nextStep,
    nextLevel,
    assignedUserId,
    assignedRole,
    assignedUserName,
    assignedUserPhone,
    nextDueAt: nextStep ? computeNextDueAt(args.escalationLadder, nextIndex) : null,
    historyEntry,
  };
}

export async function appendEscalationDelivery(admin: AdminClient, args: {
  organizationId: string;
  facilityId: string;
  taskInstanceId: string;
  escalationLevel: number;
  targetRole: string | null;
  targetUserId: string | null;
  targetPhone: string | null;
  channel: "in_app" | "sms" | "voice";
  deliveryStatus: "queued" | "sent" | "failed" | "skipped";
  providerMessageId?: string | null;
  providerPayload?: Record<string, unknown>;
  errorMessage?: string | null;
  createdBy?: string | null;
}) {
  await admin.from("operation_escalation_deliveries" as never).insert({
    organization_id: args.organizationId,
    facility_id: args.facilityId,
    task_instance_id: args.taskInstanceId,
    escalation_level: args.escalationLevel,
    target_role: args.targetRole,
    target_user_id: args.targetUserId,
    target_phone: args.targetPhone,
    channel: args.channel,
    delivery_status: args.deliveryStatus,
    provider_message_id: args.providerMessageId ?? null,
    provider_payload: args.providerPayload ?? {},
    error_message: args.errorMessage ?? null,
    created_by: args.createdBy ?? null,
  } as never);
}
