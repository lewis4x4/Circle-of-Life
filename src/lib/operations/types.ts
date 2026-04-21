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

export type OperationTask = {
  id: string;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: OperationTaskShift | null;
  assigned_to: string | null;
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
  days_overdue: number;
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
