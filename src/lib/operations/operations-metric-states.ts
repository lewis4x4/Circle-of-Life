/**
 * What the Operations KPI tiles and empty states actually know (COL-649).
 *
 * A failed or unscoped read is not "0 tasks", a window with no published tasks
 * is not "0% complete", and an empty overdue list over a scope with no tasks
 * is not "all on schedule". Pages turn these states into tiles through the
 * shared MetricState primitive.
 */
import {
  canClaimAllClear,
  metricLoading,
  metricNeedsFacility,
  metricNoData,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";
import type { OperationTaskSummary } from "@/lib/operations/types";

export const OPERATIONS_NO_TASKS_PUBLISHED = "No tasks published";

type ReadStatus = { loading?: boolean; error?: unknown };

function readGate<T>(read: ReadStatus): MetricState<T> | null {
  if (read.loading) return metricLoading();
  if (read.error) return metricUnavailable();
  return null;
}

export type TaskSummaryTileKey =
  | "total"
  | "pending"
  | "in_progress"
  | "completed"
  | "missed"
  | "overdue"
  | "schedule_unknown";

/**
 * Tile states for a task summary. The total is a real count once the read
 * succeeded (0 tasks is a fact about the window); the breakdown tiles have
 * nothing to break down when no task was published, so they say so.
 */
export function taskSummaryTileStates(
  summary: OperationTaskSummary | null,
  read: ReadStatus,
): Record<TaskSummaryTileKey, MetricState<number>> {
  const gate = readGate<number>(read) ?? (summary ? null : metricUnavailable<number>());
  const keys: TaskSummaryTileKey[] = ["total", "pending", "in_progress", "completed", "missed", "overdue", "schedule_unknown"];
  const out = {} as Record<TaskSummaryTileKey, MetricState<number>>;
  for (const key of keys) {
    if (gate) {
      out[key] = gate;
    } else if (key === "total") {
      out[key] = metricValue(summary!.total_tasks);
    } else if (summary!.total_tasks === 0) {
      out[key] = metricNoData(OPERATIONS_NO_TASKS_PUBLISHED);
    } else {
      out[key] = metricValue(summary![key]);
    }
  }
  return out;
}

/** Completion % only exists when at least one task was published in the window. */
export function taskCompletionState(summary: OperationTaskSummary | null, read: ReadStatus): MetricState<number> {
  const gate = readGate<number>(read);
  if (gate) return gate;
  if (!summary) return metricUnavailable();
  if (summary.total_tasks === 0) return metricNoData(OPERATIONS_NO_TASKS_PUBLISHED);
  return metricValue(Math.round((summary.completed / summary.total_tasks) * 100));
}

/** Empty range copy: nothing was published — never "… is clear". */
export function rangeEmptyCopy(categoryLabel: string): { title: string; body: string } {
  return {
    title: "No tasks in this range",
    body: `No ${categoryLabel} tasks were published for this period, so there is nothing to complete or miss.`,
  };
}

export type OperationsQueueEmptyCopy = { title: string; body: string; claimsClear: boolean };

/**
 * Empty-state copy for the overdue / missed queues. The reassuring line
 * renders only when the scope actually holds published tasks: an empty queue
 * over an empty (or unreadable) scope says there is nothing to judge.
 */
export function operationsQueueEmptyCopy(input: {
  queue: "overdue" | "missed";
  /** Tasks in scope for the window, from a separate read; null when that read failed. */
  scopeTaskCount: number | null;
  scopeError?: unknown;
}): OperationsQueueEmptyCopy {
  const title = input.queue === "overdue" ? "No overdue tasks" : "No missed tasks";
  const clear = canClaimAllClear({
    error: input.scopeError,
    scopeSize: input.scopeTaskCount,
    issueCount: 0,
  });
  if (clear) {
    return {
      title,
      body:
        input.queue === "overdue"
          ? "All tasks are on schedule. Great work keeping operations running on time."
          : "All tasks are on track. Great work keeping operations running smoothly.",
      claimsClear: true,
    };
  }
  if (input.scopeError || input.scopeTaskCount === null) {
    return {
      title,
      body: "The task list for this scope could not be read, so this is not an all-clear.",
      claimsClear: false,
    };
  }
  return {
    title,
    body: `No operations tasks are published for this scope yet, so nothing can be ${input.queue}. Check Needs attention for task setups that are not published.`,
    claimsClear: false,
  };
}

type AssetLike = { next_service_due_at: string | null; linked_template_count: number };

export type AssetSummaryStates = Record<"total" | "overdue" | "dueSoon" | "templated", MetricState<number>>;

/**
 * Asset register tiles. With no facility chosen the register is not read at
 * all, so the tiles name the missing choice rather than showing red/amber 0s.
 */
export function assetSummaryStates(input: {
  facilitySelected: boolean;
  loading?: boolean;
  error?: unknown;
  assets: readonly AssetLike[];
  now?: Date;
  dueSoonDays: number;
}): AssetSummaryStates {
  if (!input.facilitySelected) {
    const s = metricNeedsFacility<number>();
    return { total: s, overdue: s, dueSoon: s, templated: s };
  }
  const gate = readGate<number>(input);
  if (gate) return { total: gate, overdue: gate, dueSoon: gate, templated: gate };
  const now = input.now ?? new Date();
  const overdue = input.assets.filter((a) => a.next_service_due_at && new Date(a.next_service_due_at) < now).length;
  const dueSoon = input.assets.filter((a) => {
    if (!a.next_service_due_at) return false;
    const diffDays = (new Date(a.next_service_due_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= input.dueSoonDays;
  }).length;
  return {
    total: metricValue(input.assets.length),
    overdue: metricValue(overdue),
    dueSoon: metricValue(dueSoon),
    templated: metricValue(input.assets.filter((a) => a.linked_template_count > 0).length),
  };
}

type TemplateLike = { is_active: boolean; facility_id: string | null; license_threatening: boolean };

export type TemplateSummaryStates = Record<"active" | "orgWide" | "licenseThreatening" | "inactive", MetricState<number>>;

/**
 * Template library tiles. A failed read is unavailable, and a tile the status
 * filter excludes ("Inactive history" while showing active only) is not 0.
 */
export function templateSummaryStates(input: {
  loading?: boolean;
  error?: unknown;
  templates: readonly TemplateLike[];
  statusFilter: "all" | "active" | "inactive";
}): TemplateSummaryStates {
  const gate = readGate<number>(input);
  if (gate) return { active: gate, orgWide: gate, licenseThreatening: gate, inactive: gate };
  const hidden = metricNoData<number>("Hidden by status filter");
  const t = input.templates;
  return {
    active: input.statusFilter === "inactive" ? hidden : metricValue(t.filter((x) => x.is_active).length),
    orgWide: metricValue(t.filter((x) => !x.facility_id).length),
    licenseThreatening: metricValue(t.filter((x) => x.license_threatening).length),
    inactive: input.statusFilter === "active" ? hidden : metricValue(t.filter((x) => !x.is_active).length),
  };
}
