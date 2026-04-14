"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Clock3,
  Eye,
  Play,
  RefreshCw,
  UserRound,
  Filter,
  X,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { QuickCheckDrawer, type QuickCheckTask } from "@/components/rounding/QuickCheckDrawer";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo-mode";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";

type LiveTaskRow = {
  id: string;
  due_at: string;
  status: string;
  residents?: { first_name: string | null; last_name: string | null; preferred_name: string | null; room_number?: string | null } | null;
  staff?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  shift_assignments?: { shift_type: string | null } | null;
};

type StatusFilter = "all" | "critical" | "overdue" | "pending" | "completed" | "late";

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

const DEMO_TASKS: LiveTaskRow[] = [
  { id: "d1", due_at: new Date(Date.now() - 45 * 60000).toISOString(), status: "critically_overdue", residents: { first_name: "Dorothy", last_name: "Henderson", preferred_name: "Dot", room_number: "112A" }, staff: { first_name: "Maria", last_name: "Santos", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d2", due_at: new Date(Date.now() - 12 * 60000).toISOString(), status: "overdue", residents: { first_name: "Robert", last_name: "Chen", preferred_name: "Bob", room_number: "204B" }, staff: { first_name: "James", last_name: "Wilson", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d3", due_at: new Date(Date.now() + 5 * 60000).toISOString(), status: "pending", residents: { first_name: "Eleanor", last_name: "Vasquez", preferred_name: null, room_number: "118" }, staff: { first_name: "Sarah", last_name: "Kim", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d4", due_at: new Date(Date.now() + 22 * 60000).toISOString(), status: "pending", residents: { first_name: "Harold", last_name: "Mitchell", preferred_name: "Harry", room_number: "301A" }, staff: { first_name: "Lisa", last_name: "Nguyen", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d5", due_at: new Date(Date.now() + 35 * 60000).toISOString(), status: "pending", residents: { first_name: "Margaret", last_name: "Thompson", preferred_name: "Peggy", room_number: "215" }, staff: { first_name: "Maria", last_name: "Santos", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d6", due_at: new Date(Date.now() - 90 * 60000).toISOString(), status: "completed_on_time", residents: { first_name: "William", last_name: "O'Brien", preferred_name: "Bill", room_number: "102" }, staff: { first_name: "James", last_name: "Wilson", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d7", due_at: new Date(Date.now() - 120 * 60000).toISOString(), status: "completed_on_time", residents: { first_name: "Ruth", last_name: "Abernathy", preferred_name: null, room_number: "108" }, staff: { first_name: "Sarah", last_name: "Kim", preferred_name: null }, shift_assignments: { shift_type: "day" } },
  { id: "d8", due_at: new Date(Date.now() - 60 * 60000).toISOString(), status: "completed_late", residents: { first_name: "Frank", last_name: "Kowalski", preferred_name: null, room_number: "220" }, staff: { first_name: "Lisa", last_name: "Nguyen", preferred_name: null }, shift_assignments: { shift_type: "day" } },
];

function statusConfig(status: string) {
  if (status === "critically_overdue" || status === "missed")
    return { label: "Critical", icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30", badgeVariant: "destructive" as const, pulse: true, filterGroup: "critical" as StatusFilter };
  if (status === "overdue")
    return { label: "Overdue", icon: Clock3, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", badgeVariant: "outline" as const, pulse: true, filterGroup: "overdue" as StatusFilter };
  if (status === "completed_on_time")
    return { label: "On time", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", badgeVariant: "outline" as const, pulse: false, filterGroup: "completed" as StatusFilter };
  if (status === "completed_late")
    return { label: "Late", icon: Clock, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", badgeVariant: "outline" as const, pulse: false, filterGroup: "late" as StatusFilter };
  if (status === "excused")
    return { label: "Excused", icon: UserRound, color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/30", badgeVariant: "outline" as const, pulse: false, filterGroup: "all" as StatusFilter };
  return { label: "Pending", icon: Eye, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/30", badgeVariant: "outline" as const, pulse: false, filterGroup: "pending" as StatusFilter };
}

function formatDueLabel(value: string) {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return "Unknown";
  const diff = dueAt.getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return "Now";
  if (diff > 0) return `in ${mins}m`;
  return `${mins}m ago`;
}

function isActionable(status: string) {
  return !status.startsWith("completed") && status !== "excused";
}

function toDrawerTask(task: LiveTaskRow): QuickCheckTask {
  return {
    id: task.id,
    residentName: displayName(task.residents) || "Resident",
    roomLabel: (task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number
      ? `RM ${(task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number}`
      : null,
    dueAt: task.due_at,
    status: task.status,
  };
}

export default function AdminRoundingLivePage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const demo = isDemoMode();
  const [, setLoading] = useState(true);
  const [tasks, setTasks] = useState<LiveTaskRow[]>(DEMO_TASKS);
  const [demoFallbackActive, setDemoFallbackActive] = useState(demo);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTask, setDrawerTask] = useState<QuickCheckTask | null>(null);
  const [sequentialMode, setSequentialMode] = useState(false);
  const [sequentialIndex, setSequentialIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setDemoFallbackActive(demo);
      setTasks(DEMO_TASKS);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("resident_observation_tasks")
        .select("id, due_at, status, residents ( first_name, last_name, preferred_name, room_number ), staff:assigned_staff_id ( first_name, last_name, preferred_name ), shift_assignments ( shift_type )")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("due_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
        .order("due_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      const rows = (data ?? []) as unknown as LiveTaskRow[];
      setDemoFallbackActive(rows.length === 0 && demo);
      setTasks(rows.length > 0 ? rows : DEMO_TASKS);
    } catch {
      setDemoFallbackActive(demo);
      setTasks(DEMO_TASKS);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [tasks],
  );

  // Apply status filter
  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return sorted;
    if (statusFilter === "critical") {
      return sorted.filter((t) => t.status === "critically_overdue" || t.status === "missed");
    }
    if (statusFilter === "overdue") {
      return sorted.filter((t) => t.status === "overdue");
    }
    if (statusFilter === "pending") {
      return sorted.filter((t) => isActionable(t.status) && t.status !== "overdue" && t.status !== "critically_overdue" && t.status !== "missed");
    }
    if (statusFilter === "completed") {
      return sorted.filter((t) => t.status === "completed_on_time");
    }
    if (statusFilter === "late") {
      return sorted.filter((t) => t.status === "completed_late");
    }
    return sorted;
  }, [sorted, statusFilter]);

  const actionableQueue = useMemo(
    () => sorted.filter((t) => isActionable(t.status)),
    [sorted],
  );

  const criticalCount = sorted.filter((t) => t.status === "critically_overdue" || t.status === "missed").length;
  const overdueCount = sorted.filter((t) => t.status === "overdue").length;
  const pendingCount = sorted.filter((t) => isActionable(t.status) && t.status !== "overdue" && t.status !== "critically_overdue" && t.status !== "missed").length;
  const completedCount = sorted.filter((t) => t.status.startsWith("completed")).length;
  const lateCount = sorted.filter((t) => t.status === "completed_late").length;
  const hasCriticals = criticalCount > 0;

  function openSingleCheck(task: LiveTaskRow) {
    setSequentialMode(false);
    setDrawerTask(toDrawerTask(task));
    setDrawerOpen(true);
  }

  function startSequentialRounds() {
    if (actionableQueue.length === 0) return;
    setSequentialMode(true);
    setSequentialIndex(0);
    setDrawerTask(toDrawerTask(actionableQueue[0]));
    setDrawerOpen(true);
  }

  function advanceSequential() {
    const nextIdx = sequentialIndex + 1;
    if (nextIdx < actionableQueue.length) {
      setSequentialIndex(nextIdx);
      setDrawerTask(toDrawerTask(actionableQueue[nextIdx]));
    } else {
      setDrawerOpen(false);
      setSequentialMode(false);
      void load();
    }
  }

  function handleCompleted(taskId: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "completed_on_time" } : t)),
    );
  }

  function handleDrawerClose() {
    setDrawerOpen(false);
    setSequentialMode(false);
    if (drawerTask) void load();
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix
        hasCriticals={hasCriticals}
        primaryClass="bg-cyan-700/10"
        secondaryClass="bg-indigo-900/10"
      />

      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Live Monitor</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Live Rounding Board
                {hasCriticals && <PulseDot colorClass="bg-rose-500" />}
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
                Tap any resident to record a check, or start sequential rounds
              </p>
            </div>
            <div className="hidden md:block">
              <RoundingHubNav />
            </div>
          </div>
        </header>

        {demoFallbackActive ? (
          <AdminLiveDataFallbackNotice
            message="Demo mode is active on the Live Rounding Board. These tasks are illustrative sample checks because no live rounding tasks were returned for the current scope."
            onRetry={() => void load()}
          />
        ) : null}

        {/* Clickable stat cards */}
        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
          <StatCard
            label="Critical"
            value={String(criticalCount)}
            color={hasCriticals ? "rose" : "emerald"}
            pulse={hasCriticals}
            active={statusFilter === "critical"}
            onClick={() => setStatusFilter(statusFilter === "critical" ? "all" : "critical")}
          />
          <StatCard
            label="Overdue"
            value={String(overdueCount)}
            color={overdueCount > 0 ? "amber" : "emerald"}
            pulse={overdueCount > 0}
            active={statusFilter === "overdue"}
            onClick={() => setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")}
          />
          <StatCard
            label="Pending"
            value={String(pendingCount)}
            color="cyan"
            active={statusFilter === "pending"}
            onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
          />
          <StatCard
            label="Completed"
            value={String(completedCount)}
            color="emerald"
            active={statusFilter === "completed" || statusFilter === "late"}
            onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
          />
        </KineticGrid>

        {/* Status filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Filter:</span>
          <StatusFilterChip
            label="Critical"
            count={criticalCount}
            active={statusFilter === "critical"}
            onClick={() => setStatusFilter(statusFilter === "critical" ? "all" : "critical")}
            color="rose"
          />
          <StatusFilterChip
            label="Overdue"
            count={overdueCount}
            active={statusFilter === "overdue"}
            onClick={() => setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")}
            color="amber"
          />
          <StatusFilterChip
            label="Pending"
            count={pendingCount}
            active={statusFilter === "pending"}
            onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
            color="cyan"
          />
          <StatusFilterChip
            label="On Time"
            count={completedCount - lateCount}
            active={statusFilter === "completed"}
            onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
            color="emerald"
          />
          <StatusFilterChip
            label="Late"
            count={lateCount}
            active={statusFilter === "late"}
            onClick={() => setStatusFilter(statusFilter === "late" ? "all" : "late")}
            color="orange"
          />
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1 transition-colors ml-auto"
            >
              <X className="h-3 w-3" />
              Clear filter
            </button>
          )}
        </div>

        {/* Primary actions */}
        <div className="flex flex-wrap items-center gap-3">
          {actionableQueue.length > 0 && (
            <button
              onClick={startSequentialRounds}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-200",
                "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white",
                "hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.98]",
                "shadow-lg shadow-emerald-900/30",
              )}
            >
              <Play className="h-4 w-4" />
              Start Rounds ({actionableQueue.length} due)
            </button>
          )}
          <Button
            onClick={() => void load()}
            variant="outline"
            className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Task list */}
        <MotionList className="grid grid-cols-1 gap-4">
          {filteredTasks.map((task) => {
            const cfg = statusConfig(task.status);
            const Icon = cfg.icon;
            const canCheck = isActionable(task.status);

            return (
              <MotionItem key={task.id}>
                <div
                  className={cn(
                    "group relative overflow-hidden rounded-[2rem] border p-5 transition-all duration-300 shadow-sm hover:shadow-lg dark:hover:shadow-white/[0.01]",
                    "bg-white/60 backdrop-blur-3xl dark:bg-black/20",
                    cfg.bg,
                    canCheck && "cursor-pointer tap-responsive hover:brightness-105",
                  )}
                  onClick={canCheck ? () => openSingleCheck(task) : undefined}
                  role={canCheck ? "button" : undefined}
                  tabIndex={canCheck ? 0 : undefined}
                  onKeyDown={canCheck ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSingleCheck(task); } } : undefined}
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                    <div className={cn("flex items-center gap-2 shrink-0 md:mb-0 mb-2 w-full md:w-auto border-b md:border-b-0 border-white/10 pb-2 md:pb-0", cfg.color)}>
                      <Icon aria-hidden className="h-6 w-6" />
                      {cfg.pulse && <PulseDot colorClass={cfg.color.replace("text-", "bg-")} />}
                    </div>

                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-semibold text-lg md:text-xl font-display text-slate-900 dark:text-slate-100 truncate tracking-tight">
                          {displayName(task.residents) || "Resident"}
                        </span>
                        {(task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number && (
                          <span className="text-[10px] font-mono tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800/50 px-2 py-0.5 rounded border border-slate-200/50 dark:border-white/5">
                            RM {(task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs font-medium text-slate-500 dark:text-zinc-500 mt-1 uppercase tracking-widest">
                        <span>{displayName(task.staff) || "Unassigned"}</span>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <span>{task.shift_assignments?.shift_type ?? "—"} shift</span>
                      </div>
                    </div>

                    <div className="text-left md:text-right shrink-0 flex items-center justify-between md:justify-end gap-4 w-full md:w-auto mt-4 md:mt-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-white/5">
                      <div>
                        <span className={cn("text-xs font-mono font-bold tracking-widest", cfg.color)}>{formatDueLabel(task.due_at)}</span>
                        <div className="mt-1.5 md:mt-1">
                          <Badge variant={cfg.badgeVariant} className="text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 shadow-sm">
                            {cfg.label}
                          </Badge>
                        </div>
                      </div>
                      {canCheck && (
                        <div className={cn(
                          "rounded-full border px-6 py-2.5 text-[10px] uppercase tracking-widest font-bold transition-all shadow-md",
                          "border-emerald-500/50 bg-emerald-600 text-white",
                          "group-hover:bg-emerald-500 group-hover:border-emerald-400 group-hover:shadow-lg hover:-translate-y-0.5 scale-100",
                        )}>
                          Check In
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </MotionItem>
            );
          })}

          {filteredTasks.length === 0 && (
            <div className="rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] p-16 text-center backdrop-blur-3xl shadow-sm">
              <Eye aria-hidden className="mx-auto h-12 w-12 text-slate-300 dark:text-white/10 mb-4" />
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">All Clear</p>
              <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 mt-1">
                {statusFilter === "all" ? "No rounding tasks found for the current scope." : `No tasks match the ${statusFilter} filter.`}
              </p>
              {statusFilter !== "all" && (
                <button
                  onClick={() => setStatusFilter("all")}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mt-2"
                >
                  Clear filter
                </button>
              )}
            </div>
          )}
        </MotionList>

        <div className="block md:hidden pt-2">
          <RoundingHubNav />
        </div>
      </div>

      {/* The QuickCheck slide-up drawer */}
      <QuickCheckDrawer
        task={drawerTask}
        open={drawerOpen}
        onClose={handleDrawerClose}
        onCompleted={handleCompleted}
        queuePosition={sequentialMode ? { current: sequentialIndex + 1, total: actionableQueue.length } : null}
        onNextTask={sequentialMode ? advanceSequential : undefined}
      />
    </div>
  );
}

function StatCard({ label, value, color, pulse, active, onClick }: { label: string; value: string; color: string; pulse?: boolean; active?: boolean; onClick: () => void }) {
  const colorClasses = {
    rose: { border: "border-rose-500/20", text: "text-rose-400", sparkline: "text-rose-500", ring: "ring-rose-500" },
    amber: { border: "border-amber-500/20", text: "text-amber-400", sparkline: "text-amber-500", ring: "ring-amber-500" },
    cyan: { border: "border-cyan-500/20", text: "text-cyan-400", sparkline: "text-cyan-500", ring: "ring-cyan-500" },
    emerald: { border: "border-emerald-500/20", text: "text-emerald-400", sparkline: "text-emerald-500", ring: "ring-emerald-500" },
    orange: { border: "border-orange-500/20", text: "text-orange-400", sparkline: "text-orange-500", ring: "ring-orange-500" },
  }[color] ?? { border: "", text: "text-slate-400", sparkline: "text-slate-500", ring: "ring-slate-500" };

  return (
    <div className="h-[100px]">
      <button
        onClick={onClick}
        className="w-full h-full text-left transition-transform active:scale-[0.98]"
      >
        <V2Card hoverColor={color} className={cn(
          colorClasses.border,
          "transition-all duration-300",
          active && `ring-2 ${colorClasses.ring} ring-offset-2 ring-offset-background`
        )}>
          <Sparkline colorClass={colorClasses.sparkline} variant={1} />
          <div className="relative z-10 flex flex-col h-full justify-between">
            <h3 className={cn("text-[10px] font-mono tracking-widest uppercase flex items-center gap-2", colorClasses.text)}>
              {label}
              {pulse && <PulseDot colorClass={colorClasses.text.replace("text-", "bg-")} />}
              <Filter className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
            </h3>
            <p className={cn("text-2xl font-mono tracking-tighter pb-1", colorClasses.text)}>{value}</p>
          </div>
        </V2Card>
      </button>
    </div>
  );
}

function StatusFilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: "rose" | "amber" | "cyan" | "emerald" | "orange" }) {
  const colorClasses: Record<typeof color, string> = {
    rose: "border-rose-500/30 text-rose-400 hover:bg-rose-500/10",
    amber: "border-amber-500/30 text-amber-400 hover:bg-amber-500/10",
    cyan: "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10",
    emerald: "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10",
    orange: "border-orange-500/30 text-orange-400 hover:bg-orange-500/10",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium transition-all border flex items-center gap-2",
        active
          ? "bg-slate-800 text-white border-slate-600"
          : `bg-slate-800/30 text-slate-400 hover:text-slate-200 ${colorClasses[color]}`
      )}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
}
