"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Filter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { buildCalendarCells, getRangeForView, shiftRangeAnchor } from "@/lib/operations/dates";
import { OPERATION_CATEGORY_LABELS, OPERATION_SHIFT_LABELS } from "@/lib/operations/constants";
import { groupOperationTasksByDate, summarizeOperationTasks } from "@/lib/operations/server";
import type { OperationTask, OperationTaskResponse } from "@/lib/operations/types";
import { cn } from "@/lib/utils";

const statusColors = {
  pending: "bg-slate-100 text-slate-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  missed: "bg-red-100 text-red-800",
  deferred: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-zinc-100 text-zinc-800",
} as const;

export function OperationsCalendarPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [tasks, setTasks] = useState<OperationTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => getRangeForView("month", anchorDate), [anchorDate]);
  const calendarCells = useMemo(() => buildCalendarCells(anchorDate), [anchorDate]);
  const groupedTasks = useMemo(() => groupOperationTasksByDate(tasks), [tasks]);
  const summary = useMemo(() => summarizeOperationTasks(tasks, range.dateFrom, range.dateTo), [tasks, range.dateFrom, range.dateTo]);

  useEffect(() => {
    if (!selectedDate || !groupedTasks.has(selectedDate)) {
      setSelectedDate(range.dateFrom);
    }
  }, [groupedTasks, range.dateFrom, selectedDate]);

  const selectedDayTasks = groupedTasks.get(selectedDate) ?? [];

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams({
      date_from: range.dateFrom,
      date_to: range.dateTo,
    });

    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    if (selectedStatus !== "all") params.set("status", selectedStatus);

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load operations calendar");

      const data = (await response.json()) as OperationTaskResponse;
      setTasks(data.tasks ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load operations calendar");
    } finally {
      setIsLoading(false);
    }
  }, [range.dateFrom, range.dateTo, selectedFacilityId, selectedStatus]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-80 rounded-lg" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-100 p-2">
            <Calendar className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Operations Calendar</h1>
            <p className="text-sm text-muted-foreground">Month grid with same-day agenda for the loaded queue.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnchorDate((current) => shiftRangeAnchor("month", current, "prev"))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] rounded-lg bg-muted/50 px-4 py-2 text-center">
            <span className="font-medium">{range.label}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAnchorDate((current) => shiftRangeAnchor("month", current, "next"))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Link href="/admin/operations">
            <Button variant="outline" size="sm" className="ml-2">
              Today
            </Button>
          </Link>
        </div>
      </div>

      <OperationsViewNav />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <CalendarStatCard label="Total" value={String(summary.total_tasks)} />
        <CalendarStatCard label="Pending" value={String(summary.pending)} className="bg-slate-100/50 border-slate-200 text-slate-800" />
        <CalendarStatCard label="In Progress" value={String(summary.in_progress)} className="bg-blue-100/50 border-blue-200 text-blue-800" />
        <CalendarStatCard label="Completed" value={String(summary.completed)} className="bg-green-100/50 border-green-200 text-green-800" />
        <CalendarStatCard label="Overdue" value={String(summary.overdue)} className="bg-red-100/50 border-red-200 text-red-800" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
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

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border bg-background p-4">
          <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell) => {
              const dayTasks = groupedTasks.get(cell.date) ?? [];
              const overdueCount = dayTasks.filter((task) => task.days_overdue > 0).length;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDate(cell.date)}
                  className={cn(
                    "min-h-[112px] rounded-lg border p-2 text-left transition-colors",
                    cell.is_current_month ? "bg-background" : "bg-muted/20 text-muted-foreground",
                    cell.date === selectedDate && "border-emerald-500 ring-2 ring-emerald-200",
                    cell.is_today && "border-emerald-400",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("text-sm font-semibold", cell.is_today && "text-emerald-700")}>
                      {Number(cell.date.slice(-2))}
                    </span>
                    {dayTasks.length > 0 && (
                      <Badge className="bg-emerald-100 text-emerald-800">{dayTasks.length}</Badge>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {dayTasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="truncate rounded bg-muted/50 px-2 py-1">
                        {task.template_name}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-muted-foreground">+{dayTasks.length - 3} more</div>
                    )}
                    {overdueCount > 0 && (
                      <div className="font-medium text-red-700">{overdueCount} overdue</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Day Agenda</h2>
            <p className="text-sm text-muted-foreground">{selectedDate || range.dateFrom}</p>
          </div>

          {selectedDayTasks.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No operations tasks on this date.
            </div>
          )}

          {selectedDayTasks.length > 0 && (
            <div className="space-y-3">
              {selectedDayTasks.map((task) => (
                <article key={task.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge className={cn("text-xs", statusColors[task.status])}>
                      {task.status.replace("_", " ")}
                    </Badge>
                    {task.license_threatening && (
                      <Badge className="bg-red-600 text-xs text-white">License Risk</Badge>
                    )}
                  </div>
                  <h3 className="font-semibold">{task.template_name}</h3>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>{task.facility_name}</p>
                    <p>{OPERATION_CATEGORY_LABELS[task.template_category] || task.template_category}</p>
                    <p>
                      {task.assigned_shift
                        ? OPERATION_SHIFT_LABELS[task.assigned_shift] || task.assigned_shift
                        : "Facility-wide"}
                      {task.due_at ? ` · Due ${new Date(task.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                    </p>
                    <p>Assigned to: {task.assigned_to_name || "Unassigned"}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CalendarStatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-muted/30 p-4", className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
