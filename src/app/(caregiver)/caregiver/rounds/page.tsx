"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";

import { RoundingTaskCard, type RoundingTaskCardData } from "@/components/rounding/RoundingTaskCard";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { FloorWorkflowStrip } from "@/components/caregiver/FloorWorkflowStrip";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";

type TaskApiRow = {
  id: string;
  due_at: string;
  note: string | null;
  derived_status: RoundingTaskCardData["derivedStatus"];
  residents?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; bed_id: string | null } | null;
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
      setConfigError("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
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

      const response = await fetch(`/api/rounding/tasks?facilityId=${encodeURIComponent(resolved.ctx.facilityId)}&limit=100`, {
        cache: "no-store",
      });
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
      urgent: activeTasks.filter((task) => task.derivedStatus === "critically_overdue" || task.derivedStatus === "missed"),
      due: activeTasks.filter((task) => task.derivedStatus === "overdue" || task.derivedStatus === "due_now"),
      next: activeTasks.filter((task) => task.derivedStatus === "due_soon" || task.derivedStatus === "upcoming"),
      done: tasks.filter((task) => task.derivedStatus === "completed_on_time" || task.derivedStatus === "completed_late"),
    };
  }, [roundingSync.queuedTaskIdSet, tasks]);

  if (configError) {
    return <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-6 py-4 text-sm text-rose-100 backdrop-blur-md">{configError}</div>;
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <p className="text-sm font-medium tracking-wide uppercase">Syncing Rounds…</p>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto pb-6 space-y-6">
      <FloorWorkflowStrip
        active="rounds"
        title="Work due checks first, then move back into tasks or meds as the shift demands."
        description="Rounds is the time-bound safety queue. Use it for due-now checks, then return to the ADL queue for routine work or to meds when a pass window opens."
      />
      
      {/* ─── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-white tracking-tight">Smart Rounds</h1>
          <p className="text-zinc-400 mt-1 uppercase tracking-widest text-xs font-semibold">
            {facilityName ? `${facilityName} live queue` : "Live queue"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
             onClick={() => void load()}
             className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5 tap-responsive"
          >
             <RefreshCw className="w-4 h-4 text-zinc-300" />
          </button>
          <div className="glass-panel px-4 py-2 rounded-full border border-white/10 text-xs font-semibold text-emerald-400 flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                roundingSync.isSyncing
                  ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,1)]"
                  : !roundingSync.online
                    ? "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,1)]"
                    : roundingSync.pendingCount > 0
                      ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,1)]"
                      : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)]"
              }`}
            ></span>
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
        <div className="rounded-[1rem] border border-rose-800/60 bg-rose-950/30 px-5 py-4 text-sm text-rose-200">
          {loadError}
        </div>
      )}

      {roundingSync.pendingCount > 0 && (
        <div className="rounded-[1rem] border border-amber-700/50 bg-amber-950/20 px-5 py-4 text-sm text-amber-100">
          {roundingSync.pendingCount} round{roundingSync.pendingCount === 1 ? "" : "s"} queued for sync.
          {roundingSync.online ? " The service worker will keep retrying in the background." : " They will upload when the device reconnects."}
        </div>
      )}

      {/* ─── METRICS BLOCK ─────────────────────────────────────────────────── */}
      <div className="glass-card rounded-[1.5rem] p-4 flex flex-wrap gap-2 md:grid md:grid-cols-4">
        <MetricPill icon={<AlertTriangle className="h-3 w-3" />} label="Critical" value={String(grouped.urgent.length)} tone="danger" />
        <MetricPill icon={<Clock3 className="h-3 w-3" />} label="Due now" value={String(grouped.due.length)} tone="warning" />
        <MetricPill icon={<Clock3 className="h-3 w-3" />} label="Next up" value={String(grouped.next.length)} tone="neutral" />
        <MetricPill icon={<CheckCircle2 className="h-3 w-3" />} label="Completed" value={String(grouped.done.length)} tone="success" />
      </div>

      {/* ─── LIST SECTIONS ─────────────────────────────────────────────────── */}
      <Section title="Critical / Missed" tone="danger" emptyMessage="No critical rounds right now." count={grouped.urgent.length}>
        {grouped.urgent.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Due Now" tone="warning" emptyMessage="No due-now rounds." count={grouped.due.length}>
        {grouped.due.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Coming Up" tone="neutral" emptyMessage="No upcoming rounds in window." count={grouped.next.length}>
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
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-950/40 text-rose-100 border-transparent shadow-[inset_0_0_20px_rgba(225,29,72,0.15)]"
      : tone === "warning"
        ? "bg-amber-950/30 text-amber-100 border-transparent"
        : tone === "success"
          ? "bg-emerald-950/20 text-emerald-100 border-transparent"
          : "bg-white/5 text-zinc-100 border-transparent";
          
  const iconColor = 
      tone === "danger" ? "text-rose-400" : tone === "warning" ? "text-amber-400" : tone === "success" ? "text-emerald-400" : "text-zinc-400";

  return (
    <div className={`flex-1 min-w-[120px] rounded-xl border px-4 py-3 flex flex-col justify-between ${toneClass}`}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-zinc-400">
        <span className={iconColor}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-display font-medium tabular-nums tracking-tight ${tone === 'neutral' ? 'opacity-80' : ''}`}>
         {value}
      </div>
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
  tone: "neutral" | "warning" | "danger";
  emptyMessage: string;
  count: number;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  
  if (items.length === 0 && tone === "neutral") return null;

  return (
    <section className="space-y-4 pb-2">
      <div className="flex items-center gap-3 border-b border-white/5 pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">{title}</h2>
        <span className="px-2 py-0.5 rounded-full bg-white/10 text-white text-[10px] font-bold">
           {count}
        </span>
      </div>
      {items.length === 0 ? (
         <div className="glass-card rounded-[1.5rem] border-dashed border-2 border-white/5 p-8 text-center bg-transparent">
             <p className="text-sm text-zinc-500 font-medium tracking-wide">{emptyMessage}</p>
         </div>
      ) : (
        <div className="space-y-3">{items}</div>
      )}
    </section>
  );
}
