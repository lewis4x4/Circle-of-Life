"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, FileText, Filter, ShieldCheck, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { getRangeForView, shiftRangeAnchor, type OperationRangeView } from "@/lib/operations/dates";
import { OPERATION_CATEGORY_LABELS, OPERATION_SHIFT_LABELS } from "@/lib/operations/constants";
import type { OperationTask, OperationTaskResponse, OperationTaskSummary } from "@/lib/operations/types";
import { formatMetric, type MetricState } from "@/lib/metrics/metric-state";
import { rangeEmptyCopy, taskCompletionState, taskSummaryTileStates } from "@/lib/operations/operations-metric-states";
import { cn } from "@/lib/utils";

type OperationsTaskRangePageProps = {
  view: OperationRangeView;
  title: string;
  category: string;
  iconName: "calendar" | "file-text" | "shield-check" | "building";
  iconClassName: string;
  iconWrapClassName: string;
};

const priorityColors = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  normal: "bg-blue-100 text-blue-800 border-blue-200",
  low: "bg-slate-100 text-slate-800 border-slate-200",
} as const;

const statusColors = {
  pending: "bg-slate-100 text-slate-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  missed: "bg-red-100 text-red-800",
  deferred: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-zinc-100 text-zinc-800",
} as const;

export function OperationsTaskRangePage({
  view,
  title,
  category,
  iconName,
  iconClassName,
  iconWrapClassName,
}: OperationsTaskRangePageProps) {
  const Icon = iconName === "calendar"
    ? Calendar
    : iconName === "file-text"
      ? FileText
      : iconName === "shield-check"
        ? ShieldCheck
        : Building2;

  const { selectedFacilityId } = useFacilityStore();
  const [tasks, setTasks] = useState<OperationTask[]>([]);
  const [summary, setSummary] = useState<OperationTaskSummary | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => getRangeForView(view, anchorDate), [view, anchorDate]);

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams({
      category,
      date_from: range.dateFrom,
      date_to: range.dateTo,
    });

    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    if (selectedStatus !== "all") params.set("status", selectedStatus);

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load operations tasks");

      const data = (await response.json()) as OperationTaskResponse;
      setTasks(data.tasks ?? []);
      setSummary(data.summary ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load operations tasks");
    } finally {
      setIsLoading(false);
    }
  }, [category, range.dateFrom, range.dateTo, selectedFacilityId, selectedStatus]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const tiles = taskSummaryTileStates(summary, { error });
  const completion = taskCompletionState(summary, { error });
  const completionCard = summary?.missed
    ? { label: "Missed", state: tiles.missed, className: "bg-red-100/50 border-red-200 text-red-800" }
    : {
        label: "Completion",
        state: completion,
        className: completion.status === "value" ? "bg-green-100/50 border-green-200 text-green-800" : undefined,
      };
  const emptyCopy = rangeEmptyCopy(OPERATION_CATEGORY_LABELS[category] || category);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-80 rounded-lg" />
        <div className="grid gap-3 md:grid-cols-2">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-lg p-2", iconWrapClassName)}>
            <Icon className={cn("h-5 w-5", iconClassName)} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {summary ? `${summary.total_tasks} tasks in ${range.label}` : range.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label={`Previous ${view}`} onClick={() => setAnchorDate((current) => shiftRangeAnchor(view, current, "prev"))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-[180px] rounded-lg bg-muted/50 px-4 py-2 text-center">
            <span className="font-medium">{range.label}</span>
          </div>
          <Button variant="outline" size="sm" aria-label={`Next ${view}`} onClick={() => setAnchorDate((current) => shiftRangeAnchor(view, current, "next"))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Link href="/admin/operations">
            <Button variant="outline" size="sm" className="ml-2">
              Today
            </Button>
          </Link>
        </div>
      </div>

      <OperationsViewNav />

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SummaryCard label="Total" state={tiles.total} />
          <SummaryCard label="Completed" state={tiles.completed} className="bg-green-100/50 border-green-200 text-green-800" />
          <SummaryCard label="In Progress" state={tiles.in_progress} className="bg-blue-100/50 border-blue-200 text-blue-800" />
          <SummaryCard label="Pending" state={tiles.pending} className="bg-slate-100/50 border-slate-200 text-slate-800" />
          <SummaryCard
            label={completionCard.label}
            state={completionCard.state}
            format={completionCard.label === "Completion" ? (v) => `${v}%` : undefined}
            className={completionCard.className}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select aria-label="Status"
          value={selectedStatus}
          onChange={(event) => setSelectedStatus(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="deferred">Deferred</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={loadTasks}>
            Retry
          </Button>
        </div>
      )}

      {tasks.length === 0 && !error && (
        <div className="rounded-xl border bg-muted/20 p-10 text-center">
          <h2 className="text-lg font-semibold">{emptyCopy.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{emptyCopy.body}</p>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <article
              key={task.id}
              className={cn(
                "rounded-lg border p-4 transition-shadow hover:shadow-md",
                priorityColors[task.priority],
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-xs", statusColors[task.status])}>
                    {task.status.replace("_", " ")}
                  </Badge>
                  {task.license_threatening && (
                    <Badge className="bg-red-600 text-xs text-white">License Risk</Badge>
                  )}
                </div>
                <Badge variant="outline" className="text-xs">
                  {OPERATION_CATEGORY_LABELS[task.template_category] || task.template_category}
                </Badge>
              </div>

              <h3 className="font-semibold">{task.template_name}</h3>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <p>{task.facility_name}</p>
                <p>
                  {task.assigned_shift
                    ? OPERATION_SHIFT_LABELS[task.assigned_shift] || task.assigned_shift
                    : "Facility-wide"}
                  {" · "}
                  {task.assigned_shift_date}
                </p>
                <p>Assigned to: {task.assigned_to_name || "Unassigned"}</p>
                <p>
                  {task.estimated_minutes ?? 0}m
                  {task.due_at ? ` · Due ${new Date(task.due_at).toLocaleString()}` : " · Schedule needs confirmation"}
                </p>
                {task.due_judgment === "overdue" && (
                  <p className="font-medium text-red-700">Overdue by {task.days_overdue} day{task.days_overdue === 1 ? "" : "s"}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  state,
  format,
  className,
}: {
  label: string;
  state: MetricState<number>;
  format?: (value: number) => string;
  className?: string;
}) {
  const hasValue = state.status === "value";
  return (
    <div data-metric-state={state.status} className={cn("rounded-lg border bg-muted/30 p-4", hasValue && className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={hasValue ? "text-2xl font-bold" : "text-base font-medium leading-8 text-muted-foreground"}>
        {formatMetric(state, format)}
      </div>
    </div>
  );
}
