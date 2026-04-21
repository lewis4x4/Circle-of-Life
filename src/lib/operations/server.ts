import { differenceInCalendarDays } from "date-fns";

import { formatDateOnly, getRangeForView, parseDateParam } from "@/lib/operations/dates";
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
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: OperationTaskShift | null;
  assigned_to: string | null;
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
};

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
  dateFrom: string;
  dateTo: string;
}): OperationTaskResponse {
  const now = new Date();
  const tasks = args.rows
    .map((row) => shapeOperationTask(row, args.facilityNames, args.assigneeNames, now))
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
    completion_rate: 0,
  };

  for (const task of tasks) {
    if (task.status === "pending") summary.pending += 1;
    if (task.status === "in_progress") summary.in_progress += 1;
    if (task.status === "completed") summary.completed += 1;
    if (task.status === "missed") summary.missed += 1;
    if (task.status === "deferred") summary.deferred += 1;
    if (task.status === "cancelled") summary.cancelled += 1;
    if (task.days_overdue > 0 && (task.status === "pending" || task.status === "in_progress")) {
      summary.overdue += 1;
    }
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
  now: Date,
): OperationTask {
  const daysOverdue = calculateDaysOverdue(row, now);

  return {
    id: row.id,
    template_id: row.template_id,
    template_name: row.template_name,
    template_category: row.template_category,
    template_cadence_type: row.template_cadence_type,
    assigned_shift_date: row.assigned_shift_date,
    assigned_shift: row.assigned_shift,
    assigned_to: row.assigned_to,
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
    facility_name: facilityNames.get(row.facility_id) ?? "Unknown Facility",
    created_at: row.created_at,
    updated_at: row.updated_at,
    days_overdue: daysOverdue,
  };
}

function calculateDaysOverdue(task: OperationTaskRow, now: Date) {
  if (task.status !== "pending" && task.status !== "in_progress") return 0;

  const reference = task.due_at ? new Date(task.due_at) : new Date(`${task.assigned_shift_date}T00:00:00Z`);
  if (Number.isNaN(reference.getTime()) || reference >= now) return 0;
  return Math.max(1, differenceInCalendarDays(now, reference));
}

function compareOperationTasks(left: OperationTask, right: OperationTask) {
  const overdueDelta = right.days_overdue - left.days_overdue;
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
