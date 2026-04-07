export type ObservationTaskStatus =
  | "upcoming"
  | "due_soon"
  | "due_now"
  | "overdue"
  | "critically_overdue"
  | "missed"
  | "completed_on_time"
  | "completed_late"
  | "excused"
  | "reassigned"
  | "escalated";

export type ObservationEntryMode = "live" | "late" | "offline_synced" | "bulk";

export type ObservationQuickStatus =
  | "awake"
  | "asleep"
  | "calm"
  | "agitated"
  | "confused"
  | "distressed"
  | "not_found"
  | "refused";

export type ObservationExceptionType =
  | "resident_not_found"
  | "resident_declined_interaction"
  | "resident_appears_ill"
  | "resident_appears_injured"
  | "environmental_hazard_present"
  | "family_concern_reported"
  | "assignment_impossible"
  | "other";

export type PlanRuleInput = {
  id?: string;
  intervalType: "continuous" | "fixed_minutes" | "per_shift" | "daypart";
  intervalMinutes?: number | null;
  shift?: "day" | "evening" | "night" | "custom" | null;
  daypartStart?: string | null;
  daypartEnd?: string | null;
  daysOfWeek?: number[];
  graceMinutes?: number;
  requiredFieldsSchema?: Record<string, unknown>;
  escalationPolicyKey?: string | null;
  sortOrder?: number;
  active?: boolean;
};

export type ObservationPlanInput = {
  id?: string;
  facilityId: string;
  entityId?: string | null;
  residentId: string;
  status?: "draft" | "active" | "paused" | "ended" | "cancelled";
  sourceType?: "care_plan" | "manual" | "policy" | "order" | "triggered";
  effectiveFrom?: string;
  effectiveTo?: string | null;
  rationale?: string | null;
  rules: PlanRuleInput[];
};

export type ObservationTaskRow = {
  id: string;
  organization_id: string;
  entity_id: string | null;
  facility_id: string;
  resident_id: string;
  plan_id: string;
  plan_rule_id: string | null;
  watch_instance_id: string | null;
  shift_assignment_id: string | null;
  assigned_staff_id: string | null;
  scheduled_for: string;
  due_at: string;
  grace_ends_at: string;
  status: ObservationTaskStatus;
  completed_log_id: string | null;
  reassigned_from_staff_id: string | null;
  reassignment_reason: string | null;
  excused_reason: string | null;
  excused_by: string | null;
  escalated_at: string | null;
  notes: string | null;
  deleted_at?: string | null;
};

export type CompletionPayload = {
  observedAt?: string;
  quickStatus: ObservationQuickStatus;
  residentLocation?: string | null;
  residentPosition?: string | null;
  residentState?: string | null;
  distressPresent?: boolean;
  breathingConcern?: boolean;
  painConcern?: boolean;
  toiletingAssisted?: boolean;
  hydrationOffered?: boolean;
  repositioned?: boolean;
  skinConcernObserved?: boolean;
  fallHazardObserved?: boolean;
  refusedAssistance?: boolean;
  interventionCodes?: string[];
  note?: string | null;
  lateReason?: string | null;
  exceptionType?: ObservationExceptionType | null;
  exceptionSeverity?: "low" | "medium" | "high" | "critical" | null;
};

export type GeneratedTaskInput = {
  organizationId: string;
  entityId?: string | null;
  facilityId: string;
  residentId: string;
  planId: string;
  planRuleId: string | null;
  watchInstanceId?: string | null;
  shiftAssignmentId?: string | null;
  assignedStaffId?: string | null;
  scheduledFor: string;
  dueAt: string;
  graceEndsAt: string;
  status: ObservationTaskStatus;
  notes?: string | null;
};
