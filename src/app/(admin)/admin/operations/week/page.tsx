"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Clock, CheckCircle2, Filter, User } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type TaskInstance = {
  id: string;
  template_name: string;
  template_category: string;
  assigned_shift_date: string;
  assigned_shift: "day" | "evening" | "night";
  assigned_to_name: string | null;
  status: "pending" | "in_progress" | "completed" | "missed" | "deferred";
  due_at: string | null;
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  estimated_minutes: number;
  facility_name: string;
};

type WeekSummary = {
  week_start: string;
  week_end: string;
  total_tasks: number;
  completed: number;
  in_progress: number;
  pending: number;
  missed: number;
};

export default function WeeklyTasksPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { loading: authLoading } = useHavenAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.setDate(diff));
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWeeklyTasks = useCallback(async () => {
    if (authLoading) return;
    setError(null);

    const params = new URLSearchParams();
    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    params.set("category", "weekly_rounds");
    if (selectedStatus !== "all") params.set("status", selectedStatus);
    params.set("week_start", currentWeekStart.toISOString());
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    params.set("week_end", weekEnd.toISOString());

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load weekly tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
      setWeekSummary(data.week_summary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load weekly tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, selectedStatus, currentWeekStart, authLoading]);

  useEffect(() => {
    void loadWeeklyTasks();
  }, [loadWeeklyTasks]);

  const handleNavigateWeek = (direction: "prev" | "next") => {
    const newWeekStart = new Date(currentWeekStart);
    newWeekStart.setDate(newWeekStart.getDate() + (direction === "next" ? 7 : -7));
    setCurrentWeekStart(newWeekStart);
  };

  const getWeekRangeLabel = () => {
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    return `${formatter.format(currentWeekStart)} – ${formatter.format(end)}`;
  };

  const priorityColors = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-blue-100 text-blue-800 border-blue-200",
    low: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const statusColors = {
    pending: "bg-slate-100 text-slate-800",
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    missed: "bg-red-100 text-red-800",
    deferred: "bg-yellow-100 text-yellow-800",
  };

  const shiftLabels = {
    day: "Day",
    evening: "Eve",
    night: "Night",
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-80 rounded-lg" />
        <div className="grid gap-3 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Calendar className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Weekly Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {weekSummary ? `${weekSummary.total_tasks} tasks this week` : "Loading..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleNavigateWeek("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-4 py-2 bg-muted/50 rounded-lg min-w-[160px] text-center">
            <span className="font-medium">{getWeekRangeLabel()}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => handleNavigateWeek("next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Link href="/admin/operations">
            <Button variant="outline" size="sm" className="ml-2">
              Today
            </Button>
          </Link>
        </div>
      </div>

      {/* Week Summary Cards */}
      {weekSummary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-4 bg-muted/30 rounded-lg border">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{weekSummary.total_tasks}</div>
          </div>
          <div className="p-4 bg-green-100/50 rounded-lg border border-green-200">
            <div className="text-sm text-green-700">Completed</div>
            <div className="text-2xl font-bold text-green-800">{weekSummary.completed}</div>
          </div>
          <div className="p-4 bg-blue-100/50 rounded-lg border border-blue-200">
            <div className="text-sm text-blue-700">In Progress</div>
            <div className="text-2xl font-bold text-blue-800">{weekSummary.in_progress}</div>
          </div>
          <div className="p-4 bg-slate-100/50 rounded-lg border border-slate-200">
            <div className="text-sm text-slate-700">Pending</div>
            <div className="text-2xl font-bold text-slate-800">{weekSummary.pending}</div>
          </div>
          {weekSummary.missed > 0 && (
            <div className="p-4 bg-red-100/50 rounded-lg border border-red-200">
              <div className="text-sm text-red-700">Missed</div>
              <div className="text-2xl font-bold text-red-800">{weekSummary.missed}</div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="bg-background border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <p className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={loadWeeklyTasks} className="mt-2">
            Retry
          </Button>
        </div>
      )}

      {/* Tasks grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={cn(
              "p-4 rounded-lg border hover:shadow-md transition-shadow",
              priorityColors[task.priority]
            )}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge className={cn(statusColors[task.status], "text-xs")}>
                  {task.status.replace("_", " ")}
                </Badge>
                {task.license_threatening && (
                  <Badge className="bg-red-600 text-white text-xs">⚠️ License</Badge>
                )}
              </div>
              <Badge variant="outline" className="text-xs">
                {shiftLabels[task.assigned_shift]}
              </Badge>
            </div>

            <h3 className="font-semibold mb-1">{task.template_name}</h3>

            <div className="text-sm space-y-1 mb-3">
              <p className="text-muted-foreground">
                {new Date(task.assigned_shift_date).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="h-3 w-3" />
                <span className="text-xs">{task.assigned_to_name || "Unassigned"}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {task.estimated_minutes}m
              </p>
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="default" className="flex-1">
                View Details
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {tasks.length === 0 && !isLoading && !error && (
        <div className="text-center py-16">
          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-semibold mb-2">No weekly tasks</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            There are no weekly tasks scheduled for this week.
          </p>
        </div>
      )}
    </div>
  );
}
