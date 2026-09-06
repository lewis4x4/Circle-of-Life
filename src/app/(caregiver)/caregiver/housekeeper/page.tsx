"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchHousekeepingBrief, type HousekeeperDashboardBrief } from "@/lib/housekeeper/dashboard-brief";
import { BedDouble, CheckCircle2, AlertTriangle, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HousekeeperDashboardPage() {
  const [brief, setBrief] = useState<HousekeeperDashboardBrief | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchHousekeepingBrief();
      setBrief(data);
    } catch (e) {
      console.error("[housekeeper-dashboard]", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(taskId: string, action: "start" | "complete" | "escalate") {
    if (busy) return;
    setBusy(taskId); setActionError(null);
    try {
      const response = await fetch(`/api/admin/operations/tasks/${taskId}/${action}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completion_notes: notes[taskId] ?? "", reason: notes[taskId] ?? "" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Task action failed");
      await load();
    } catch(e) { setActionError(e instanceof Error ? e.message : "Task action failed"); } finally { setBusy(null); }
  }

  if (isLoading) return <LoadingSkeleton />;

  if (!brief) return <ErrorState onRetry={load} />;

  const completionTone: "success" | "warning" | "destructive" =
    brief.completionPct >= 80 ? "success" : brief.completionPct >= 50 ? "warning" : "destructive";
  const completionColorClass =
    completionTone === "success"
      ? "text-success"
      : completionTone === "warning"
        ? "text-warning"
        : "text-destructive";
  const completionFillClass =
    completionTone === "success"
      ? "bg-success"
      : completionTone === "warning"
        ? "bg-warning"
        : "bg-destructive";

  return (
    <div className="space-y-8 px-4 pb-12">
      {actionError && <p role="alert">{actionError}</p>}
      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-info" /> Housekeeping
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">My Dashboard</h1>
        <p className="mt-1 text-sm font-medium tracking-wide text-muted-foreground">
          Room assignments, priority cleans, and shift summary
        </p>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MobileStat title="Assigned" value={brief.roomsAssigned} icon={BedDouble} tone="info" />
        <MobileStat title="Completed" value={brief.roomsCompleted} icon={CheckCircle2} tone="success" />
        <MobileStat
          title="Priority"
          value={brief.priorityCleans}
          icon={AlertTriangle}
          tone={brief.priorityCleans > 0 ? "destructive" : "neutral"}
        />
        <MobileStat title="Hours (Week)" value={brief.hoursThisWeek} icon={Clock} tone="warning" />
      </div>

      {/* Completion progress */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Completion</span>
          <span className={cn("text-2xl font-medium tabular-nums", completionColorClass)}>
            {brief.completionPct}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-[var(--motion-duration)]", completionFillClass)}
            style={{ width: `${Math.min(brief.completionPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-foreground">
          <BedDouble className="h-4 w-4 text-info" /> Today&apos;s assigned tasks
        </h3>
        {brief.tasks.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border py-8 text-center">
            <p className="text-sm font-medium text-muted-foreground">No housekeeping tasks are assigned for today. Ask your shift lead to configure or assign the cleaning schedule.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {brief.tasks.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex min-h-[44px] items-center justify-between rounded-lg border p-3.5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                  t.status === "completed"
                    ? "border-success/30 bg-success/10"
                    : t.isPriority
                      ? "border-destructive/30 bg-destructive/10"
                      : "border-border bg-card hover:bg-muted/40",
                )}
              >
                <div>
                  <span className="text-[14px] font-semibold text-foreground">{t.roomNumber || t.taskType}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.taskType}</span>
                </div>
                <div className="flex items-center gap-2">
                  {t.isPriority && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                      Priority
                    </span>
                  )}
                  {t.status !== "completed" && <div><label>Work notes<input value={notes[t.id] ?? ""} onChange={(e) => setNotes((prior) => ({ ...prior, [t.id]: e.target.value }))} className="block rounded border bg-background p-2" /></label><button disabled={!!busy} onClick={() => void act(t.id, t.status === "pending" ? "start" : "complete")}>{t.status === "pending" ? "Start" : "Done"}</button><button disabled={!!busy || !notes[t.id]?.trim()} onClick={() => void act(t.id, "escalate")}>Cannot complete — notify lead</button></div>}
                  <span
                    className={cn(
                      "text-xs font-medium",
                      t.status === "completed" ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileStat({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType<{ className?: string }>;
  tone: "info" | "success" | "warning" | "destructive" | "neutral";
}) {
  const valueColor =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : tone === "info"
            ? "text-info"
            : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        <Icon className={cn("h-4 w-4", valueColor)} />
      </div>
      <span className={cn("text-3xl font-medium tabular-nums", valueColor)}>{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 px-4 pt-2">
      <Skeleton className="h-28 w-full rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <p className="mb-4 text-lg text-muted-foreground">Unable to load housekeeping dashboard.</p>
        <button
          onClick={onRetry}
          className="min-h-[44px] rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
