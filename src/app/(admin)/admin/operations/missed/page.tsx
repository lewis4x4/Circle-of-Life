"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Clock, Filter, Calendar, ChevronLeft } from "lucide-react";
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
  missed_at: string | null;
};

export default function MissedTasksPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { loading: authLoading } = useHavenAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const loadMissedTasks = useCallback(async () => {
    if (authLoading) return;
    setError(null);

    const params = new URLSearchParams();
    if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
    params.set("status", "missed");
    if (selectedCategory !== "all") params.set("category", selectedCategory);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/operations/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load missed tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load missed tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, selectedCategory, authLoading]);

  useEffect(() => {
    void loadMissedTasks();
  }, [loadMissedTasks]);

  const handleReinstate = async (taskId: string) => {
    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/reinstate`, {
        method: "PATCH",
      });
      if (response.ok) {
        void loadMissedTasks();
      }
    } catch {
      // Error handling
    }
  };

  const priorityColors = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-blue-100 text-blue-800 border-blue-200",
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
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Missed Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} requiring attention
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
          <Button variant="default" size="sm" onClick={loadMissedTasks}>
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
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={loadMissedTasks} className="mt-2">
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
            {criticalTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "p-4 rounded-lg border cursor-pointer hover:shadow-md transition-shadow",
                  priorityColors[task.priority]
                )}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-red-600 text-white text-xs">MISSED</Badge>
                    <Badge className="bg-red-600 text-white text-xs">⚠️ License Threat</Badge>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {categoryLabels[task.template_category] || task.template_category}
                  </Badge>
                </div>
                <h3 className="font-semibold mb-1">{task.template_name}</h3>
                <div className="text-sm space-y-1">
                  <p className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(task.assigned_shift_date).toLocaleDateString()}
                    </span>
                    <span className="ml-3">
                      {task.assigned_shift} shift
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Assigned to: {task.assigned_to_name || "Unassigned"}
                  </p>
                  {task.missed_at && (
                    <p className="text-red-600 dark:text-red-400 text-xs">
                      Missed: {new Date(task.missed_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleReinstate(task.id);
                    }}
                  >
                    Reinstate
                  </Button>
                  <Button size="sm" variant="outline">
                    View Details
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-critical missed tasks */}
      {nonCriticalTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Other Missed ({nonCriticalTasks.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {nonCriticalTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "p-4 rounded-lg border cursor-pointer hover:shadow-md transition-shadow",
                  priorityColors[task.priority]
                )}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <Badge className="bg-yellow-100 text-yellow-800 text-xs">MISSED</Badge>
                  <Badge variant="outline" className="text-xs">
                    {categoryLabels[task.template_category] || task.template_category}
                  </Badge>
                </div>
                <h3 className="font-semibold mb-1">{task.template_name}</h3>
                <div className="text-sm space-y-1">
                  <p className="text-muted-foreground">
                    {new Date(task.assigned_shift_date).toLocaleDateString()} · {task.assigned_shift}
                  </p>
                  <p className="text-muted-foreground">
                    {task.assigned_to_name || "Unassigned"}
                  </p>
                </div>
                <div className="mt-3">
                  <Button size="sm" variant="default" onClick={(e) => {
                    e.stopPropagation();
                    void handleReinstate(task.id);
                  }}>
                    Reinstate
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && !isLoading && !error && (
        <div className="text-center py-16">
          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-semibold mb-2">No missed tasks</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            All tasks are on track. Great work keeping operations running smoothly.
          </p>
        </div>
      )}

      {/* Task detail modal */}
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
