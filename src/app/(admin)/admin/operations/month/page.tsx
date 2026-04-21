"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, CheckCircle2, Filter, User, FileText } from "lucide-react";
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

type MonthSummary = {
  month: string;
  year: number;
  total_tasks: number;
  completed: number;
  in_progress: number;
  pending: number;
  missed: number;
  completion_rate: number;
};

export default function MonthlyTasksPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { loading: authLoading } = useHavenAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [monthSummary, setMonthSummary] = useState<MonthSummary | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMonthlyTasks = useCallback(async () => {
    if (authLoading) return;
    setError(null);

    const params = new URLSearchParams();
    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    params.set("category", "monthly_rounds");
    if (selectedStatus !== "all") params.set("status", selectedStatus);
    params.set("month", currentMonth.toISOString());

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load monthly tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
      setMonthSummary(data.month_summary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load monthly tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, selectedStatus, currentMonth, authLoading]);

  useEffect(() => {
    void loadMonthlyTasks();
  }, [loadMonthlyTasks]);

  const handleNavigateMonth = (direction: "prev" | "next") => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + (direction === "next" ? 1 : -1));
    setCurrentMonth(newMonth);
  };

  const getMonthLabel = () => {
    return currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const priorityColors = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-purple-100 text-purple-800 border-purple-200",
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
          <div className="p-2 bg-purple-100 rounded-lg">
            <FileText className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Monthly Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {monthSummary ? `${monthSummary.total_tasks} tasks in ${getMonthLabel()}` : "Loading..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleNavigateMonth("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-4 py-2 bg-muted/50 rounded-lg min-w-[140px] text-center">
            <span className="font-medium">{getMonthLabel()}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => handleNavigateMonth("next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Link href="/admin/operations">
            <Button variant="outline" size="sm" className="ml-2">
              Today
            </Button>
          </Link>
        </div>
      </div>

      {/* Month Summary Cards */}
      {monthSummary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-4 bg-muted/30 rounded-lg border">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{monthSummary.total_tasks}</div>
          </div>
          <div className="p-4 bg-green-100/50 rounded-lg border border-green-200">
            <div className="text-sm text-green-700">Completed</div>
            <div className="text-2xl font-bold text-green-800">{monthSummary.completed}</div>
          </div>
          <div className="p-4 bg-blue-100/50 rounded-lg border border-blue-200">
            <div className="text-sm text-blue-700">In Progress</div>
            <div className="text-2xl font-bold text-blue-800">{monthSummary.in_progress}</div>
          </div>
          <div className="p-4 bg-slate-100/50 rounded-lg border border-slate-200">
            <div className="text-sm text-slate-700">Pending</div>
            <div className="text-2xl font-bold text-slate-800">{monthSummary.pending}</div>
          </div>
          <div className={cn(
            "p-4 rounded-lg border",
            monthSummary.missed > 0 ? "bg-red-100/50 border-red-200" : "bg-green-100/50 border-green-200"
          )}>
            <div className={cn(
              "text-sm",
              monthSummary.missed > 0 ? "text-red-700" : "text-green-700"
            )}>
              {monthSummary.missed > 0 ? "Missed" : "On Track"}
            </div>
            <div className="text-2xl font-bold text-green-800">
              {monthSummary.completion_rate}%
            </div>
          </div>
        </div>
      )}

      {/* Completion rate bar */}
      {monthSummary && (
        <div className="p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Monthly Completion Rate</span>
            <span className="text-sm text-muted-foreground">{monthSummary.completion_rate}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                monthSummary.completion_rate >= 90 ? "bg-green-500" :
                monthSummary.completion_rate >= 70 ? "bg-blue-500" :
                monthSummary.completion_rate >= 50 ? "bg-yellow-500" :
                "bg-red-500"
              )}
              style={{ width: `${monthSummary.completion_rate}%` }}
            />
          </div>
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
          <Button variant="outline" size="sm" onClick={loadMonthlyTasks} className="mt-2">
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
          <h3 className="text-xl font-semibold mb-2">No monthly tasks</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            There are no monthly tasks scheduled for {getMonthLabel()}.
          </p>
        </div>
      )}
    </div>
  );
}
