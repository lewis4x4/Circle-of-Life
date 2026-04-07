"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Clock3,
  Eye,
  RefreshCw,
  UserRound,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type LiveTaskRow = {
  id: string;
  due_at: string;
  status: string;
  residents?: { first_name: string | null; last_name: string | null; preferred_name: string | null; room_number?: string | null } | null;
  staff?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  shift_assignments?: { shift_type: string | null } | null;
};

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
    return { label: "Critical", icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30", badgeVariant: "destructive" as const, pulse: true };
  if (status === "overdue")
    return { label: "Overdue", icon: Clock3, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", badgeVariant: "outline" as const, pulse: true };
  if (status === "completed_on_time")
    return { label: "On time", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", badgeVariant: "outline" as const, pulse: false };
  if (status === "completed_late")
    return { label: "Late", icon: Clock, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", badgeVariant: "outline" as const, pulse: false };
  if (status === "excused")
    return { label: "Excused", icon: UserRound, color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/30", badgeVariant: "outline" as const, pulse: false };
  return { label: "Pending", icon: Eye, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/30", badgeVariant: "outline" as const, pulse: false };
}

function formatDueLabel(value: string) {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return "Unknown";
  const now = Date.now();
  const diff = dueAt.getTime() - now;
  const absDiff = Math.abs(diff);
  const mins = Math.round(absDiff / 60000);

  if (mins < 1) return "Now";
  if (diff > 0) return `in ${mins}m`;
  return `${mins}m ago`;
}

export default function AdminRoundingLivePage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<LiveTaskRow[]>(DEMO_TASKS);

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
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
      setTasks(rows.length > 0 ? rows : DEMO_TASKS);
    } catch {
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

  const criticalCount = sorted.filter((t) => t.status === "critically_overdue" || t.status === "missed").length;
  const overdueCount = sorted.filter((t) => t.status === "overdue").length;
  const pendingCount = sorted.filter((t) => t.status === "pending").length;
  const completedCount = sorted.filter((t) => (t.status).startsWith("completed")).length;
  const hasCriticals = criticalCount > 0;

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
                Due, overdue, and completed checks by resident, shift, and assigned staff
              </p>
            </div>
            <div className="hidden md:block">
              <RoundingHubNav />
            </div>
          </div>
        </header>

        <KineticGrid className="grid-cols-2 md:grid-cols-4 gap-4" staggerMs={50}>
          <QuickStat label="Critical" value={String(criticalCount)} color={hasCriticals ? "rose" : "emerald"} pulse={hasCriticals} />
          <QuickStat label="Overdue" value={String(overdueCount)} color={overdueCount > 0 ? "amber" : "emerald"} pulse={overdueCount > 0} />
          <QuickStat label="Pending" value={String(pendingCount)} color="cyan" />
          <QuickStat label="Completed" value={String(completedCount)} color="emerald" />
        </KineticGrid>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => void load()}
            variant="outline"
            className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh board
          </Button>
        </div>

        <KineticGrid className="grid-cols-1 gap-3" staggerMs={30} baseDelayMs={100}>
          {sorted.map((task) => {
            const cfg = statusConfig(task.status);
            const Icon = cfg.icon;
            return (
              <div key={task.id} className={cn(
                "group relative overflow-hidden rounded-[14px] border p-4 transition-all duration-300",
                "bg-white/5 backdrop-blur-md dark:bg-[#0A0A0A]/50",
                cfg.bg,
              )}>
                <div className="flex items-center gap-4">
                  <div className={cn("flex items-center gap-2 shrink-0", cfg.color)}>
                    <Icon aria-hidden className="h-5 w-5" />
                    {cfg.pulse && <PulseDot colorClass={cfg.color.replace("text-", "bg-")} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-100 truncate">
                        {displayName(task.residents) || "Resident"}
                      </span>
                      {(task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number && (
                        <span className="text-[10px] font-mono tracking-wider text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">
                          RM {(task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>{displayName(task.staff) || "Unassigned"}</span>
                      <span className="text-slate-700">|</span>
                      <span className="uppercase tracking-wider">{task.shift_assignments?.shift_type ?? "—"} shift</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className={cn("text-sm font-mono", cfg.color)}>{formatDueLabel(task.due_at)}</span>
                    <div className="mt-1">
                      <Badge variant={cfg.badgeVariant} className="text-[10px]">
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {sorted.length === 0 && (
            <div className="rounded-[14px] border border-slate-800/50 bg-slate-900/30 p-12 text-center">
              <Eye aria-hidden className="mx-auto h-8 w-8 text-slate-600 mb-3" />
              <p className="text-sm text-slate-400">No rounding tasks found for the current scope.</p>
              <p className="text-xs text-slate-600 mt-1">Select a facility and generate tasks from observation plans.</p>
            </div>
          )}
        </KineticGrid>

        <div className="block md:hidden pt-2">
          <RoundingHubNav />
        </div>
      </div>
    </div>
  );
}

function QuickStat({ label, value, color, pulse }: { label: string; value: string; color: string; pulse?: boolean }) {
  const colorClasses = {
    rose: { border: "border-rose-500/20", text: "text-rose-400", sparkline: "text-rose-500" },
    amber: { border: "border-amber-500/20", text: "text-amber-400", sparkline: "text-amber-500" },
    cyan: { border: "border-cyan-500/20", text: "text-cyan-400", sparkline: "text-cyan-500" },
    emerald: { border: "border-emerald-500/20", text: "text-emerald-400", sparkline: "text-emerald-500" },
  }[color] ?? { border: "", text: "text-slate-400", sparkline: "text-slate-500" };

  return (
    <div className="h-[100px]">
      <V2Card hoverColor={color} className={colorClasses.border}>
        <Sparkline colorClass={colorClasses.sparkline} variant={1} />
        <div className="relative z-10 flex flex-col h-full justify-between">
          <h3 className={cn("text-[10px] font-mono tracking-widest uppercase flex items-center gap-2", colorClasses.text)}>
            {label}
            {pulse && <PulseDot colorClass={colorClasses.text.replace("text-", "bg-")} />}
          </h3>
          <p className={cn("text-2xl font-mono tracking-tighter pb-1", colorClasses.text)}>{value}</p>
        </div>
      </V2Card>
    </div>
  );
}
