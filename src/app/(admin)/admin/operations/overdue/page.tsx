"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Filter, Calendar, ChevronLeft, CheckCircle2, User } from "lucide-react";
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
  days_overdue: number;
};

export default function OverdueTasksPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { loading: authLoading } = useHavenAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPriority, setSelectedPriority] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverdueTasks = useCallback(async () => {
    if (authLoading) return;
    setError(null);

    const params = new URLSearchParams();
    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    params.set("status", "pending");
    params.set("overdue", "true");
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedPriority !== "all") params.set("priority", selectedPriority);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load overdue tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load overdue tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, selectedCategory, selectedPriority, authLoading]);

  useEffect(() => {
    void loadOverdueTasks();
  }, [loadOverdueTasks]);

  const handleStartTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/start`, {
        method: "PATCH",
      });
      if (response.ok) {
        void loadOverdueTasks();
      }
    } catch {
      // Error handling
    }
  };

  const priorityColors = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const categoryLabels: Record<string, string> = {
    daily_rounds: "Daily Rounds",
    weekly_rounds: "Weekly Rounds",
    monthly_rounds: "Monthly Rounds",
    quarterly_rounds: "Quarterly Rounds",
    yearly_rounds: "Yearly Rounds",
    audits: "Audits",
    collections: "Collections",
    employee_file: "Employee File",
    mental_health_support: "MHSP",
  };

  const shiftLabels = {
    day: "Day",
    evening: "Eve",
    night: "Night",
  };

  const getOverdueSeverity = (days: number) => {
    if (days >= 7) return { color: "text-red-700", label: `${days}+ days overdue`, badge: "bg-red-600" };
    if (days >= 3) return { color: "text-orange-700", label: `${days} days overdue`, badge: "bg-orange-500" };
    return { color: "text-yellow-700", label: `${days} day overdue`, badge: "bg-yellow-500" };
  };

  const criticalTasks = tasks.filter((t) => t.license_threatening);
  const nonCriticalTasks = tasks.filter((t) => !t.license_threatening);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
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
          <div className="p-2 bg-orange-100 rounded-lg">
            <Clock className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Overdue Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} past due
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Link href="/admin/operations">
            <Button variant="outline" size="sm">
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back to Today
            </Button>
          </Link>
          <Button variant="default" size="sm" onClick={loadOverdueTasks}>
            <Clock className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-background border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Categories</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={selectedPriority}
          onChange={(e) => setSelectedPriority(e.target.value)}
          className="bg-background border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={loadOverdueTasks} className="mt-2">
            Retry
          </Button>
        </div>
      )}

      {/* License-threatening tasks */}
      {criticalTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            License-Threatening ({criticalTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {criticalTasks.map((task) => {
              const severity = getOverdueSeverity(task.days_overdue);
              return (
                <div
                  key={task.id}
                  className={cn(
                    "p-4 rounded-lg border border-l-4 hover:shadow-md transition-shadow",
                    priorityColors[task.priority],
                    "border-l-red-600"
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(severity.badge, "text-white text-xs")}>
                        {severity.label}
                      </Badge>
                      <Badge className="bg-red-600 text-white text-xs">⚠️ License Threat</Badge>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {categoryLabels[task.template_category] || task.template_category}
                    </Badge>
                  </div>

                  <h3 className="font-semibold mb-1">{task.template_name}</h3>

                  <div className="text-sm space-y-1 mb-3">
                    <p className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Due: {new Date(task.due_at || task.assigned_shift_date).toLocaleDateString()}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {shiftLabels[task.assigned_shift]}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="text-xs">{task.assigned_to_name || "Unassigned"}</span>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {task.estimated_minutes}m
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleStartTask(task.id)}
                    >
                      Start Now
                    </Button>
                    <Button size="sm" variant="outline">
                      View Details
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Non-critical overdue tasks */}
      {nonCriticalTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Other Overdue ({nonCriticalTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {nonCriticalTasks.map((task) => {
              const severity = getOverdueSeverity(task.days_overdue);
              return (
                <div
                  key={task.id}
                  className={cn(
                    "p-4 rounded-lg border hover:shadow-md transition-shadow",
                    priorityColors[task.priority]
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <Badge className={cn(severity.badge, "text-white text-xs")}>
                      {severity.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {categoryLabels[task.template_category] || task.template_category}
                    </Badge>
                  </div>

                  <h3 className="font-semibold mb-1">{task.template_name}</h3>

                  <div className="text-sm space-y-1 mb-3">
                    <p className="text-muted-foreground">
                      Due: {new Date(task.due_at || task.assigned_shift_date).toLocaleDateString()}
                    </p>
                    <p className="text-muted-foreground">
                      {task.assigned_to_name || "Unassigned"} · {shiftLabels[task.assigned_shift]}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleStartTask(task.id)}
                    >
                      Start
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && !isLoading && !error && (
        <div className="text-center py-16">
          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-semibold mb-2">No overdue tasks</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            All tasks are on schedule. Great work keeping operations running on time.
          </p>
        </div>
      )}
    </div>
  );
}
