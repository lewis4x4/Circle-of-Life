export const OPERATION_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "missed",
  "deferred",
  "cancelled",
] as const;

export type OperationTaskStatus = (typeof OPERATION_TASK_STATUSES)[number];

export const OPERATION_TASK_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type OperationTaskPriority = (typeof OPERATION_TASK_PRIORITIES)[number];

export const OPERATION_TASK_SHIFTS = ["day", "evening", "night"] as const;
export type OperationTaskShift = (typeof OPERATION_TASK_SHIFTS)[number];

/**
 * The evaluator's judgment of an open task (COL-137). `unknown` means the task
 * has no due instant, so no due or overdue claim exists; it is never derived
 * from the assigned date.
 */
export type OperationDueJudgment = "unknown" | "settled" | "not_due" | "overdue";

export type OperationTask = {
  id: string;
  /** Stable across template revisions; absent on older saved client responses. */
  activity_id?: string | null;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: OperationTaskShift | null;
  assigned_to: string | null;
  signed_by?: string | null;
  requires_dual_sign?: boolean;
  assigned_to_name: string | null;
  assigned_role: string | null;
  status: OperationTaskStatus;
  due_at: string | null;
  missed_at: string | null;
  deferred_until: string | null;
  priority: OperationTaskPriority;
  license_threatening: boolean;
  estimated_minutes: number | null;
  current_escalation_level: number;
  facility_id: string;
  facility_name: string;
  created_at: string;
  updated_at: string;
  due_judgment: OperationDueJudgment;
  /** Calendar days overdue in the facility timezone; null when the schedule is unknown. */
  days_overdue: number | null;
  /** COL-139 managed identity; absent or null on legacy rows and older saved responses. */
  occurrence_kind?: "scheduled" | "event" | "manual" | null;
  subject_id?: string | null;
  /** Inclusive facility-local period the occurrence covers; null for manual work. */
  period_start_date?: string | null;
  period_end_date?: string | null;
  /** Optimistic fingerprint echoed back by association commands. */
  occurrence_revision?: string | null;
  /** COL-142 execution state of a managed occurrence: none, completed, performed_missing_evidence, awaiting_verification, failed, not_performed. */
  execution_state?: string | null;
  /** Recorder-supplied instant of the work from the effective receipt; distinct from completed_at (server record time). */
  performed_at?: string | null;
  effective_receipt_id?: string | null;
};

export type OperationTaskSummary = {
  date_from: string;
  date_to: string;
  total_tasks: number;
  pending: number;
  in_progress: number;
  completed: number;
  missed: number;
  deferred: number;
  cancelled: number;
  overdue: number;
  /** Open tasks with no due instant: schedule needs confirmation, not overdue. */
  schedule_unknown: number;
  completion_rate: number;
};

export type OperationTaskPagination = {
  page: number;
  per_page: number;
  total: number;
};

export type OperationTaskResponse = {
  tasks: OperationTask[];
  summary: OperationTaskSummary;
  pagination: OperationTaskPagination;
};

export type OperationCalendarCell = {
  date: string;
  is_current_month: boolean;
  is_today: boolean;
};
