"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";

type TaskRow = {
  id: string;
  template_name: string;
  status: "pending" | "in_progress" | "completed" | "missed" | "deferred";
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  assigned_to_name: string | null;
  due_at: string | null;
  days_overdue: number;
  facility_name: string;
};

type AdequacySnapshot = {
  adequacy_score: number;
  adequacy_rating: string;
  cannot_cover_count: number;
  current_shift: "day" | "evening" | "night";
  recommended_action: string | null;
};

export default function OperationsPagerPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [adequacy, setAdequacy] = useState<AdequacySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedFacilityId) {
      setTasks([]);
      setAdequacy(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [tasksRes, adequacyRes] = await Promise.all([
        fetch(`/api/admin/operations/tasks?facility_id=${encodeURIComponent(selectedFacilityId)}`),
        fetch(`/api/admin/operations/staffing-adequacy?facility_id=${encodeURIComponent(selectedFacilityId)}`),
      ]);
      const tasksJson = await tasksRes.json();
      const adequacyJson = await adequacyRes.json();
      if (!tasksRes.ok) throw new Error(tasksJson.error || "Failed to load tasks");
      if (!adequacyRes.ok) throw new Error(adequacyJson.error || "Failed to load adequacy");
      setTasks(tasksJson.tasks || []);
      setAdequacy(adequacyJson);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load pager view.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const topItems = useMemo(() => {
    const ranked = [...tasks].sort((left, right) => {
      const urgency = scoreTask(right) - scoreTask(left);
      if (urgency !== 0) return urgency;
      return (right.days_overdue ?? 0) - (left.days_overdue ?? 0);
    });
    return ranked.slice(0, 3);
  }, [tasks]);

  async function completeTask(taskId: string) {
    await fetch(`/api/admin/operations/tasks/${taskId}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completion_notes: "Completed via pager view" }),
    });
    await load();
  }

  async function deferTask(taskId: string) {
    const later = new Date();
    later.setHours(later.getHours() + 2);
    await fetch(`/api/admin/operations/tasks/${taskId}/defer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deferred_until: later.toISOString(),
        cancellation_reason: "Deferred from pager view",
      }),
    });
    await load();
  }

  async function escalateTask(taskId: string) {
    await fetch(`/api/admin/operations/tasks/${taskId}/escalate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Escalated from pager view" }),
    });
    await load();
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
          <Zap className="h-4 w-4" />
          Pager View
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Must-act now</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Mobile-first triage of the next three operations items that should be acted on before the shift slips.
        </p>
      </div>

      <OperationsViewNav />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Link href="/admin/operations" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
          <ChevronLeft className="h-4 w-4" />
          View full queue
        </Link>
        {adequacy && (
          <Badge variant="outline">
            {adequacy.current_shift} shift · {adequacy.adequacy_score}% · {adequacy.adequacy_rating}
          </Badge>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {adequacy?.recommended_action && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base">Staffing guidance</CardTitle>
            <CardDescription>{adequacy.recommended_action}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4 text-sm text-muted-foreground">Loading pager tasks…</div>
      ) : topItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No urgent tasks. The queue is clear for the current scope.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {topItems.map((task, index) => (
            <Card key={task.id} className={task.license_threatening ? "border-red-300 shadow-red-100" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <Badge className={badgeClass(index, task)}>
                    {index === 0 ? "Priority one" : index === 1 ? "Priority two" : "Priority three"}
                  </Badge>
                  {task.license_threatening && (
                    <Badge className="bg-red-600 text-white">License risk</Badge>
                  )}
                </div>
                <CardTitle className="text-lg">{task.template_name}</CardTitle>
                <CardDescription>
                  {task.facility_name}
                  {task.assigned_to_name ? ` · ${task.assigned_to_name}` : ""}
                  {task.due_at ? ` · due ${new Date(task.due_at).toLocaleString()}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {task.days_overdue > 0 ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <Clock className="h-4 w-4" />}
                  {task.days_overdue > 0
                    ? `${task.days_overdue} day${task.days_overdue === 1 ? "" : "s"} overdue`
                    : `${task.priority} priority`}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button className="h-12 text-base" onClick={() => void completeTask(task.id)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Complete
                  </Button>
                  <Button variant="outline" className="h-12 text-base" onClick={() => void deferTask(task.id)}>
                    Defer
                  </Button>
                  <Button variant="outline" className="h-12 text-base" onClick={() => void escalateTask(task.id)}>
                    Escalate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function scoreTask(task: TaskRow) {
  if (task.license_threatening && task.days_overdue > 0) return 100;
  if (task.priority === "critical" && task.days_overdue > 0) return 90;
  if (task.priority === "high" && task.days_overdue > 0) return 80;
  if (task.priority === "critical") return 70;
  if (task.priority === "high") return 60;
  if (task.status === "in_progress") return 50;
  return 40;
}

function badgeClass(index: number, task: TaskRow) {
  if (task.license_threatening && index === 0) return "bg-red-600 text-white";
  if (index === 0) return "bg-amber-500 text-white";
  if (index === 1) return "bg-yellow-500 text-black";
  return "bg-emerald-500 text-white";
}
