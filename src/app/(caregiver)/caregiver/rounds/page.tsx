"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";

import { RoundingTaskCard, type RoundingTaskCardData } from "@/components/rounding/RoundingTaskCard";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { cn } from "@/lib/utils";

type TaskApiRow = {
  id: string;
  due_at: string;
  note: string | null;
  derived_status: RoundingTaskCardData["derivedStatus"];
  residents?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    bed_id: string | null;
  } | null;
  staff?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

export default function CaregiverRoundsPage() {
  const supabase = useMemo(() => createClient(), []);
  const roundingSync = useRoundingOfflineSync();
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [, setFacilityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<RoundingTaskCardData[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);

    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }

      setFacilityId(resolved.ctx.facilityId);
      setFacilityName(resolved.ctx.facilityName);

      const response = await fetch(
        `/api/rounding/tasks?facilityId=${encodeURIComponent(resolved.ctx.facilityId)}&limit=100`,
        {
          cache: "no-store",
        },
      );
      const json = (await response.json()) as { error?: string; tasks?: TaskApiRow[] };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load rounds");
      }

      setTasks(
        (json.tasks ?? []).map((task) => ({
          id: task.id,
          residentId: task.residents?.id ?? "unknown",
          residentName: displayName(task.residents) || "Resident",
          roomLabel: task.residents?.bed_id ? `Bed ${task.residents.bed_id.slice(-3)}` : null,
          assignedStaffName: displayName(task.staff) || null,
          dueAt: task.due_at,
          derivedStatus: task.derived_status,
          note: task.note,
        })),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load rounding queue.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const activeTasks = tasks.filter((task) => !roundingSync.queuedTaskIdSet.has(task.id));
    return {
      urgent: activeTasks.filter(
        (task) => task.derivedStatus === "critically_overdue" || task.derivedStatus === "missed",
      ),
      due: activeTasks.filter((task) => task.derivedStatus === "overdue" || task.derivedStatus === "due_now"),
      next: activeTasks.filter((task) => task.derivedStatus === "due_soon" || task.derivedStatus === "upcoming"),
      done: tasks.filter(
        (task) => task.derivedStatus === "completed_on_time" || task.derivedStatus === "completed_late",
      ),
    };
  }, [roundingSync.queuedTaskIdSet, tasks]);

  if (configError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-success" />
        <p className="text-sm font-medium uppercase tracking-wide">Syncing Rounds…</p>
      </div>
    );
  }

  const syncTone: "success" | "warning" | "destructive" = roundingSync.isSyncing
    ? "warning"
    : !roundingSync.online
      ? "destructive"
      : roundingSync.pendingCount > 0
        ? "warning"
        : "success";
  const syncDotClass =
    syncTone === "warning" ? "bg-warning" : syncTone === "destructive" ? "bg-destructive" : "bg-success";
  const syncTextClass =
    syncTone === "warning" ? "text-warning" : syncTone === "destructive" ? "text-destructive" : "text-success";

  return (
    <div className="mx-auto max-w-[800px] space-y-6 pb-6">
      <FloorWorkflowStrip
        active="rounds"
        title="Work due checks first, then move back into tasks or meds as the shift demands."
        description="Rounds is the time-bound safety queue. Use it for due-now checks, then return to the ADL queue for routine work or to meds when a pass window opens."
      />

      {/* Header */}
      <div className="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Smart Rounds</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {facilityName ? `${facilityName} live queue` : "Live queue"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            aria-label="Refresh rounds"
          >
            <RefreshCw className="h-4 w-4 text-foreground" />
          </button>
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold",
              syncTextClass,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", syncDotClass)} />
            {roundingSync.isSyncing
              ? "SYNCING"
              : !roundingSync.online
                ? "OFFLINE"
                : roundingSync.pendingCount > 0
                  ? `QUEUED ${roundingSync.pendingCount}`
                  : "SYNCED"}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-foreground">
          {loadError}
        </div>
      )}

      {roundingSync.pendingCount > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-5 py-4 text-sm text-foreground">
          {roundingSync.pendingCount} round{roundingSync.pendingCount === 1 ? "" : "s"} queued for sync.
          {roundingSync.online
            ? " The service worker will keep retrying in the background."
            : " They will upload when the device reconnects."}
        </div>
      )}

      {/* Metrics block */}
      <div className="flex flex-wrap gap-2 rounded-lg p-4 md:grid md:grid-cols-4">
        <MetricPill icon={<AlertTriangle className="h-3 w-3" />} label="Critical" value={String(grouped.urgent.length)} tone="danger" />
        <MetricPill icon={<Clock3 className="h-3 w-3" />} label="Due now" value={String(grouped.due.length)} tone="warning" />
        <MetricPill icon={<Clock3 className="h-3 w-3" />} label="Next up" value={String(grouped.next.length)} tone="muted" />
        <MetricPill icon={<CheckCircle2 className="h-3 w-3" />} label="Completed" value={String(grouped.done.length)} tone="success" />
      </div>

      {/* List sections */}
      <Section
        title="Critical / Missed"
        tone="danger"
        emptyMessage="No critical rounds right now."
        count={grouped.urgent.length}
      >
        {grouped.urgent.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Due Now" tone="warning" emptyMessage="No due-now rounds." count={grouped.due.length}>
        {grouped.due.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Coming Up" tone="muted" emptyMessage="No upcoming rounds in window." count={grouped.next.length}>
        {grouped.next.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>
    </div>
  );
}

function MetricPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "muted" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-destructive/10 border-destructive/30 text-foreground"
      : tone === "warning"
        ? "bg-warning/10 border-warning/30 text-foreground"
        : tone === "success"
          ? "bg-success/10 border-success/30 text-foreground"
          : "bg-card border-border text-foreground";

  const iconColor =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-muted-foreground";

  return (
    <div className={cn("flex min-w-[120px] flex-1 flex-col justify-between rounded-lg border px-4 py-3", toneClass)}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className={iconColor}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="text-2xl font-medium tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function Section({
  title,
  tone,
  emptyMessage,
  count,
  children,
}: {
  title: string;
  tone: "muted" | "warning" | "danger";
  emptyMessage: string;
  count: number;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);

  if (items.length === 0 && tone === "muted") return null;

  return (
    <section className="space-y-4 pb-2">
      <div className="flex items-center gap-3 border-b border-border pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-foreground">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border bg-transparent p-8 text-center">
          <p className="text-sm font-medium tracking-wide text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">{items}</div>
      )}
    </section>
  );
}
