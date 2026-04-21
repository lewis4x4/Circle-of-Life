"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, AlertTriangle, Zap, Calendar, MoreHorizontal, Filter, BarChart3, Users, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Types
type TaskStatus = "pending" | "in_progress" | "completed" | "missed" | "deferred";

type TaskInstance = {
  id: string;
  template_name: string;
  template_category: string;
  assigned_shift_date: string;
  assigned_shift: "day" | "evening" | "night";
  assigned_to: string | null;
  assigned_to_name: string | null;
  status: TaskStatus;
  due_at: string | null;
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  estimated_minutes: number;
  current_escalation_level: number;
  facility_id: string;
  facility_name: string;
};

type AdequacySnapshot = {
  adequacy_score: number;
  adequacy_rating: string;
  resident_count: number;
  scheduled_staff_count: number;
  is_compliant: boolean;
  cannot_cover_count: number;
};

type StatsBar = {
  pending: number;
  in_progress: number;
  completed_today: number;
  missed: number;
  adequacy_score: number;
};

// Priority colors
const priorityColors = {
  critical: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
  high: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800",
  normal: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
  low: "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-800",
} as const;

// Status icons
const statusIcons: Record<TaskStatus, LucideIcon> = {
  pending: Clock,
  in_progress: Zap,
  completed: CheckCircle2,
  missed: AlertTriangle,
  deferred: Clock,
};

// Shift labels
const shiftLabels = {
  day: "Day Shift · 7AM–3PM",
  evening: "Evening Shift · 3PM–11PM",
  night: "Night Shift · 11PM–7AM",
} as const;

// Category labels
const categoryLabels: Record<string, string> = {
  daily_rounds: "Daily Rounds",
  weekly_rounds: "Weekly Rounds",
  monthly_rounds: "Monthly Rounds",
  quarterly_rounds: "Quarterly Rounds",
  yearly_rounds: "Yearly Rounds",
  audits: "Audits",
  collections: "Collections",
  employee_file: "Employee File",
  mental_health_support: "Mental Health Support",
  safety: "Safety",
  maintenance: "Maintenance",
};

export default function OperationsTodayPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, user, loading: authLoading } = useHavenAuth();

  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [adequacy, setAdequacy] = useState<AdequacySnapshot | null>(null);
  const [stats, setStats] = useState<StatsBar | null>(null);
  const [selectedShift, setSelectedShift] = useState<"day" | "evening" | "night" | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Redirect non-admin roles
  useEffect(() => {
    if (authLoading) return;
    if (appRole !== "owner" && appRole !== "org_admin" && appRole !== "coo" &&
        appRole !== "facility_administrator" && appRole !== "don" &&
        appRole !== "lpn_supervisor" && appRole !== "medication_aide" &&
        appRole !== "cna" && appRole !== "dietary_manager" &&
        appRole !== "activities_director" && appRole !== "housekeeping" &&
        appRole !== "hr_manager" && appRole !== "staffing_coordinator") {
      router.replace("/dashboard");
    }
  }, [appRole, authLoading, router]);

  const loadData = useCallback(async () => {
    if (authLoading) return;
    setError(null);

    const params = new URLSearchParams();
    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    if (selectedShift !== "all") params.set("shift", selectedShift);
    if (selectedStatus !== "all") params.set("status", selectedStatus);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to load tasks");

      const data = await response.json();
      setTasks(data.tasks || []);
      setStats({
        pending: data.tasks.filter((t: TaskInstance) => t.status === "pending").length,
        in_progress: data.tasks.filter((t: TaskInstance) => t.status === "in_progress").length,
        completed_today: data.tasks.filter((t: TaskInstance) => t.status === "completed").length,
        missed: data.tasks.filter((t: TaskInstance) => t.status === "missed").length,
        adequacy_score: 0, // Loaded from separate endpoint
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, selectedShift, selectedStatus, authLoading]);

  const loadAdequacy = useCallback(async () => {
    if (authLoading || !selectedFacilityId) return;

    try {
      const response = await fetch(`/api/admin/operations/staffing-adequacy?facility_id=${selectedFacilityId}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) return;

      const data = await response.json();
      setAdequacy(data);
      if (stats) {
        setStats({ ...stats, adequacy_score: data.adequacy_score });
      }
    } catch {
      // Non-critical, continue without adequacy data
    }
  }, [selectedFacilityId, authLoading, stats]);

  useEffect(() => {
    void loadData();
    void loadAdequacy();
  }, [loadData, loadAdequacy]);

  const handleStartTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/start`, {
        method: "PATCH",
      });
      if (response.ok) {
        void loadData();
      }
    } catch {
      // Error toast would go here
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completion_notes: "Completed via Today view" }),
      });
      if (response.ok) {
        void loadData();
        void loadAdequacy();
      }
    } catch {
      // Error toast would go here
    }
  };

  const handleDeferTask = async (taskId: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/defer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deferred_until: tomorrow.toISOString(),
          cancellation_reason: "Deferred from Today view",
        }),
      });
      if (response.ok) {
        void loadData();
      }
    } catch {
      // Error toast would go here
    }
  };

  const handleBulkComplete = async () => {
    const pendingTasks = tasks.filter((t: TaskInstance) => t.status === "pending" && t.assigned_to === user?.id);
    if (pendingTasks.length === 0) return;

    try {
      const response = await fetch("/api/admin/operations/tasks/bulk-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_ids: pendingTasks.map((t: TaskInstance) => t.id),
          completion_notes: "End of shift bulk complete",
        }),
      });
      if (response.ok) {
        void loadData();
        void loadAdequacy();
      }
    } catch {
      // Error toast would go here
    }
  };

  // Get adequacy badge color
  const getAdequacyBadge = () => {
    if (!adequacy) return null;

    const { adequacy_score, adequacy_rating } = adequacy;
    let bgColor = "bg-green-100 text-green-800 border-green-200";
    let icon = CheckCircle2;

    if (adequacy_score < 70) {
      bgColor = "bg-red-100 text-red-800 border-red-200";
      icon = AlertTriangle;
    } else if (adequacy_score < 85) {
      bgColor = "bg-yellow-100 text-yellow-800 border-yellow-200";
      icon = Clock;
    } else if (adequacy_score < 95) {
      bgColor = "bg-blue-100 text-blue-800 border-blue-200";
      icon = BarChart3;
    }

    return (
      <Badge className={cn(bgColor, "flex items-center gap-2 px-3 py-2 border rounded-lg font-medium")}>
        <icon className="h-4 w-4" />
        <span>{adequacy_score}%</span>
        <span className="text-xs opacity-70 ml-2">{adequacy_rating}</span>
      </Badge>
    );
  };

  // Get status badge color
  const getStatusBadge = (status: TaskStatus) => {
    const colors: Record<TaskStatus, string> = {
      pending: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
      in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      missed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      deferred: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    };
    return colors[status];
  };

  // Group tasks by status
  const pendingTasks = tasks.filter((t: TaskInstance) => t.status === "pending");
  const inProgressTasks = tasks.filter((t: TaskInstance) => t.status === "in_progress");
  const overdueTasks = tasks.filter((t: TaskInstance) =>
    t.status === "pending" && t.due_at && new Date(t.due_at) < new Date()
  );
  const missedTasks = tasks.filter((t: TaskInstance) => t.status === "missed");

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-10 w-80 rounded-lg" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Today {shiftLabels.day.split("·")[0].trim()}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {adequacy && getAdequacyBadge()}

          <Link href="/admin/operations/calendar">
            <Button variant="outline" size="sm">
              <Calendar className="h-4 w-4 mr-2" />
              Calendar
            </Button>
          </Link>

          <Button
            variant="default"
            size="sm"
            onClick={handleBulkComplete}
            disabled={pendingTasks.length === 0}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            End of Shift
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-muted/30 rounded-lg border">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={selectedShift}
          onChange={(e) => setSelectedShift(e.target.value as typeof selectedShift)}
          className="bg-background border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Shifts</option>
          <option value="day">Day Shift</option>
          <option value="evening">Evening Shift</option>
          <option value="night">Night Shift</option>
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as typeof selectedStatus)}
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
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="mt-2"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Overdue tasks - show first if any */}
      {overdueTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-3 text-red-700 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Overdue ({overdueTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {overdueTasks.map((task) => {
              const StatusIcon = statusIcons[task.status];
              return (
                <div
                  key={task.id}
                  className={cn(
                    "p-4 rounded-lg border cursor-pointer hover:shadow-md transition-shadow",
                    priorityColors[task.priority]
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(getStatusBadge(task.status), "text-xs")}>
                        {task.status.replace("_", " ")}
                      </Badge>
                      {task.license_threatening && (
                        <Badge className="bg-red-600 text-white text-xs">⚠️ License Threat</Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {categoryLabels[task.template_category] || task.template_category}
                    </Badge>
                  </div>

                  <h3 className="font-semibold mb-1">{task.template_name}</h3>

                  <div className="text-xs text-muted-foreground mb-3">
                    {task.estimated_minutes}m
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{task.assigned_to_name || "Unassigned"}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleStartTask(task.id)}
                        disabled={task.status !== "pending"}
                      >
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending tasks */}
      {pendingTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
            <Clock className="h-5 w-5" />
            Pending ({pendingTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pendingTasks.map((task) => {
              const StatusIcon = statusIcons[task.status];
              return (
                <div
                  key={task.id}
                  className={cn(
                    "p-4 rounded-lg border cursor-pointer hover:shadow-md transition-shadow",
                    task.license_threatening
                      ? priorityColors.critical
                      : priorityColors[task.priority]
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(getStatusBadge(task.status), "text-xs")}>
                        {task.status}
                      </Badge>
                      {task.license_threatening && (
                        <Badge className="bg-red-600 text-white text-xs">⚠️ License Threat</Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {categoryLabels[task.template_category] || task.template_category}
                    </Badge>
                  </div>

                  <h3 className="font-semibold mb-1">{task.template_name}</h3>

                  <div className="text-xs text-muted-foreground mb-3">
                    {task.estimated_minutes}m
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{task.assigned_to_name || "Unassigned"}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleStartTask(task.id)}
                      >
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* In Progress tasks */}
      {inProgressTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
            <Zap className="h-5 w-5" />
            In Progress ({inProgressTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {inProgressTasks.map((task) => {
              const StatusIcon = statusIcons[task.status];
              return (
                <div
                  key={task.id}
                  className={cn(
                    "p-4 rounded-lg border border-blue-200 dark:border-blue-800/30",
                    task.license_threatening
                      ? priorityColors.critical
                      : priorityColors[task.priority]
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(getStatusBadge(task.status), "text-xs")}>
                        {task.status.replace("_", " ")}
                      </Badge>
                      <StatusIcon className="h-3 w-3 text-blue-600" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {task.estimated_minutes}m
                    </div>
                  </div>

                  <h3 className="font-semibold mb-1">{task.template_name}</h3>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{task.assigned_to_name || "Unassigned"}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleCompleteTask(task.id)}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t shadow-lg">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Pending:</span>
                <span className="font-semibold text-lg">{stats.pending}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">In Progress:</span>
                <span className="font-semibold text-lg">{stats.in_progress}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Completed:</span>
                <span className="font-semibold text-lg">{stats.completed_today}</span>
              </div>
              {stats.missed > 0 && (
                <div className="flex items-center gap-2 text-destructive">
                  <span className="text-sm">Missed:</span>
                  <span className="font-semibold text-lg">{stats.missed}</span>
                </div>
              )}
            </div>
            {adequacy && (
              <Link href="/admin/operations/pager" className="sm:hidden">
                <Button variant="outline" size="sm">
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Pager View
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && !isLoading && !error && (
        <div className="text-center py-16">
          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-semibold mb-2">All caught up!</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            No tasks for your selected filters. Great work keeping things organized.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => {
              setSelectedShift("all");
              setSelectedStatus("all");
            }}
          >
            Clear Filters
          </Button>
        </div>
      )}

      {/* Task detail modal placeholder */}
      {selectedTaskId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold mb-4">Task Details</h2>
            <p className="text-muted-foreground mb-6">
              Task detail modal to be implemented in S2.
              Task ID: {selectedTaskId}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setSelectedTaskId(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
