import { formatDateOnly, getRangeForView, parseDateParam } from "@/lib/operations/dates";
import { formatOperationsFacilityName } from "@/lib/operations/operations-display-copy";
import { judgeDue } from "@/lib/operations/schedule-evaluator";
import type {
  OperationTask,
  OperationTaskPriority,
  OperationTaskResponse,
  OperationTaskShift,
  OperationTaskStatus,
  OperationTaskSummary,
} from "@/lib/operations/types";

type OperationTaskRow = {
  id: string;
  activity_id?: string | null;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: OperationTaskShift | null;
  assigned_to: string | null;
  signed_by?: string | null;
  requires_dual_sign?: boolean;
  assigned_role: string | null;
  status: OperationTaskStatus;
  due_at: string | null;
  missed_at: string | null;
  deferred_until: string | null;
  priority: OperationTaskPriority | null;
  license_threatening: boolean | null;
  estimated_minutes: number | null;
  current_escalation_level: number | null;
  created_at: string;
  updated_at: string;
  occurrence_kind?: "scheduled" | "event" | "manual" | null;
  subject_id?: string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
  occurrence_revision?: string | null;
  execution_state?: string | null;
  performed_at?: string | null;
  effective_receipt_id?: string | null;
};

/**
 * Every Circle of Life facility is in America/New_York (AGENTS.md); a
 * facility row's own timezone wins whenever the caller supplies it.
 */
export const DEFAULT_FACILITY_TIMEZONE = "America/New_York";

export type OperationTaskFilters = {
  facilityId: string | null;
  dateFrom: string;
  dateTo: string;
  status: OperationTaskStatus | null;
  category: string | null;
  priority: OperationTaskPriority | null;
  shift: OperationTaskShift | null;
  overdueOnly: boolean;
  assigneeRole: string | null;
};

export function parseOperationTaskFilters(searchParams: URLSearchParams): OperationTaskFilters {
  const status = parseStatus(searchParams.get("status"));
  const priority = parsePriority(searchParams.get("priority"));
  const shift = parseShift(searchParams.get("shift"));
  const category = normalizeOptional(searchParams.get("category"));
  const assigneeRole = normalizeOptional(searchParams.get("assignee_role"));

  const explicitFrom = parseDateParam(searchParams.get("date_from"));
  const explicitTo = parseDateParam(searchParams.get("date_to"));
  const legacyWeekStart = parseDateParam(searchParams.get("week_start"));
  const legacyWeekEnd = parseDateParam(searchParams.get("week_end"));
  const legacyMonth = parseDateParam(searchParams.get("month"));

  let dateFrom: string;
  let dateTo: string;

  if (explicitFrom && explicitTo) {
    dateFrom = formatDateOnly(explicitFrom);
    dateTo = formatDateOnly(explicitTo);
  } else if (legacyWeekStart && legacyWeekEnd) {
    dateFrom = formatDateOnly(legacyWeekStart);
    dateTo = formatDateOnly(legacyWeekEnd);
  } else if (legacyMonth) {
    const monthRange = getRangeForView("month", legacyMonth);
    dateFrom = monthRange.dateFrom;
    dateTo = monthRange.dateTo;
  } else {
    const today = formatDateOnly(new Date());
    dateFrom = today;
    dateTo = today;
  }

  return {
    facilityId: normalizeOptional(searchParams.get("facility_id")),
    dateFrom,
    dateTo,
    status,
    category,
    priority,
    shift,
    overdueOnly: searchParams.get("overdue") === "true",
    assigneeRole,
  };
}

export function buildOperationTaskResponse(args: {
  rows: OperationTaskRow[];
  facilityNames: Map<string, string>;
  assigneeNames: Map<string, string>;
  /** Facility id → IANA timezone; missing entries use DEFAULT_FACILITY_TIMEZONE. */
  facilityTimezones?: Map<string, string | null>;
  dateFrom: string;
  dateTo: string;
  now?: Date;
}): OperationTaskResponse {
  const now = args.now ?? new Date();
  const timezones = args.facilityTimezones ?? new Map<string, string | null>();
  const tasks = args.rows
    .map((row) => shapeOperationTask(row, args.facilityNames, args.assigneeNames, timezones, now))
    .sort(compareOperationTasks);

  return {
    tasks,
    summary: summarizeOperationTasks(tasks, args.dateFrom, args.dateTo),
    pagination: {
      page: 1,
      per_page: tasks.length,
      total: tasks.length,
    },
  };
}

export function summarizeOperationTasks(
  tasks: OperationTask[],
  dateFrom: string,
  dateTo: string,
): OperationTaskSummary {
  const summary: OperationTaskSummary = {
    date_from: dateFrom,
    date_to: dateTo,
    total_tasks: tasks.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    missed: 0,
    deferred: 0,
    cancelled: 0,
    overdue: 0,
    schedule_unknown: 0,
    completion_rate: 0,
  };

  for (const task of tasks) {
    if (task.status === "pending") summary.pending += 1;
    if (task.status === "in_progress") summary.in_progress += 1;
    if (task.status === "completed") summary.completed += 1;
    if (task.status === "missed") summary.missed += 1;
    if (task.status === "deferred") summary.deferred += 1;
    if (task.status === "cancelled") summary.cancelled += 1;
    if (task.due_judgment === "overdue") summary.overdue += 1;
    if (task.due_judgment === "unknown") summary.schedule_unknown += 1;
  }

  summary.completion_rate = summary.total_tasks > 0
    ? Math.round((summary.completed / summary.total_tasks) * 100)
    : 0;

  return summary;
}

export function groupOperationTasksByDate(tasks: OperationTask[]): Map<string, OperationTask[]> {
  const grouped = new Map<string, OperationTask[]>();
  for (const task of tasks) {
    const bucket = grouped.get(task.assigned_shift_date) ?? [];
    bucket.push(task);
    grouped.set(task.assigned_shift_date, bucket);
  }
  return grouped;
}

export function getFacilityLocalDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    date: `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`,
    hour: Number(lookup.get("hour") ?? "0"),
    minute: Number(lookup.get("minute") ?? "0"),
  };
}

export function getCurrentOperationShift(date: Date, timeZone: string): OperationTaskShift {
  const { hour } = getFacilityLocalDateTimeParts(date, timeZone);
  if (hour >= 7 && hour < 15) return "day";
  if (hour >= 15 && hour < 23) return "evening";
  return "night";
}

function shapeOperationTask(
  row: OperationTaskRow,
  facilityNames: Map<string, string>,
  assigneeNames: Map<string, string>,
  facilityTimezones: Map<string, string | null>,
  now: Date,
): OperationTask {
  // The evaluator is the only source of a due/overdue claim. A task without a
  // due instant is "schedule unknown"; the assigned date is never a deadline.
  const judged = judgeDue({
    dueAt: row.due_at,
    status: row.status,
    now,
    timeZone: facilityTimezones.get(row.facility_id) || DEFAULT_FACILITY_TIMEZONE,
  });

  return {
    id: row.id,
    activity_id: row.activity_id ?? null,
    template_id: row.template_id,
    template_name: row.template_name,
    template_category: row.template_category,
    template_cadence_type: row.template_cadence_type,
    assigned_shift_date: row.assigned_shift_date,
    assigned_shift: row.assigned_shift,
    assigned_to: row.assigned_to,
    signed_by: row.signed_by,
    requires_dual_sign: row.requires_dual_sign,
    assigned_to_name: row.assigned_to ? assigneeNames.get(row.assigned_to) ?? null : null,
    assigned_role: row.assigned_role,
    status: row.status,
    due_at: row.due_at,
    missed_at: row.missed_at,
    deferred_until: row.deferred_until,
    priority: row.priority ?? "normal",
    license_threatening: Boolean(row.license_threatening),
    estimated_minutes: row.estimated_minutes,
    current_escalation_level: row.current_escalation_level ?? 0,
    facility_id: row.facility_id,
    facility_name: formatOperationsFacilityName(facilityNames.get(row.facility_id)),
    created_at: row.created_at,
    updated_at: row.updated_at,
    due_judgment: judged.judgment,
    days_overdue: judged.days_overdue,
    // COL-139 identity passes through untouched when the caller selected it.
    ...(row.occurrence_kind !== undefined ? { occurrence_kind: row.occurrence_kind } : {}),
    ...(row.subject_id !== undefined ? { subject_id: row.subject_id } : {}),
    ...(row.period_start_date !== undefined ? { period_start_date: row.period_start_date } : {}),
    ...(row.period_end_date !== undefined ? { period_end_date: row.period_end_date } : {}),
    ...(row.occurrence_revision !== undefined ? { occurrence_revision: row.occurrence_revision } : {}),
    // COL-142 execution facts pass through untouched when the caller selected them.
    ...(row.execution_state !== undefined ? { execution_state: row.execution_state } : {}),
    ...(row.performed_at !== undefined ? { performed_at: row.performed_at } : {}),
    ...(row.effective_receipt_id !== undefined ? { effective_receipt_id: row.effective_receipt_id } : {}),
  };
}

function compareOperationTasks(left: OperationTask, right: OperationTask) {
  const overdueDelta = (right.days_overdue ?? 0) - (left.days_overdue ?? 0);
  if (overdueDelta !== 0) return overdueDelta;

  const licenseDelta = Number(right.license_threatening) - Number(left.license_threatening);
  if (licenseDelta !== 0) return licenseDelta;

  const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
  if (priorityDelta !== 0) return priorityDelta;

  const dueLeft = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  const dueRight = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (dueLeft !== dueRight) return dueLeft - dueRight;

  return left.template_name.localeCompare(right.template_name);
}

function priorityWeight(priority: OperationTaskPriority) {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function normalizeOptional(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseStatus(value: string | null): OperationTaskStatus | null {
  if (!value || value === "all") return null;
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "missed" ||
    value === "deferred" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function parsePriority(value: string | null): OperationTaskPriority | null {
  if (!value || value === "all") return null;
  if (value === "critical" || value === "high" || value === "normal" || value === "low") {
    return value;
  }
  return null;
}

function parseShift(value: string | null): OperationTaskShift | null {
  if (!value || value === "all") return null;
  if (value === "day" || value === "evening" || value === "night") return value;
  return null;
}
