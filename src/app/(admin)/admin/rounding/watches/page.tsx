"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  PlayCircle,
  Shield,
  ShieldAlert,
  StopCircle,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type WatchStatus = "pending_approval" | "active" | "paused" | "ended" | "cancelled";

type WatchProtocolRow = {
  id: string;
  name: string;
  trigger_type: string;
  duration_rule: string | null;
  approval_required: boolean;
  active: boolean;
  rule_definition_json: { steps?: Array<{ duration_minutes?: number | null }> } | null;
};

type WatchInstanceRow = {
  id: string;
  resident_id: string;
  protocol_id: string | null;
  triggered_by_type: string;
  starts_at: string;
  ends_at: string | null;
  status: WatchStatus;
  end_reason: string | null;
  resident_watch_protocols?: {
    name: string;
    trigger_type: string;
    approval_required: boolean;
  } | null;
  residents?: {
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    room_number: string | null;
  } | null;
};

type WatchEventRow = {
  id: string;
  watch_instance_id: string;
  event_type: string;
  occurred_at: string;
  note: string | null;
  residents?: {
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    room_number: string | null;
  } | null;
};

type TaskAggregateRow = {
  watch_instance_id: string | null;
  status: string;
};

type WatchTaskSummary = {
  total: number;
  open: number;
  overdue: number;
  missed: number;
};

const STATUS_STYLES: Record<
  WatchStatus,
  {
    label: string;
    className: string;
  }
> = {
  pending_approval: {
    label: "Pending approval",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  },
  active: {
    label: "Active",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  },
  paused: {
    label: "Paused",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-200",
  },
  ended: {
    label: "Ended",
    className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  },
  cancelled: {
    label: "Cancelled",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  },
};

const ACTION_LABELS: Record<string, string> = {
  watch_auto_triggered: "Auto-triggered",
  watch_approved: "Approved",
  watch_paused: "Paused",
  watch_resumed: "Resumed",
  watch_ended: "Ended",
  watch_cancelled: "Cancelled",
};

const OPEN_TASK_STATUSES = new Set([
  "upcoming",
  "due_soon",
  "due_now",
  "overdue",
  "critically_overdue",
  "reassigned",
  "escalated",
]);

function formatResidentName(row: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}) {
  return row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`;
}

function formatRelativeWindow(ts: string) {
  const dt = new Date(ts).getTime();
  const deltaMinutes = Math.round((dt - Date.now()) / 60000);
  if (Math.abs(deltaMinutes) < 60) {
    return `${Math.abs(deltaMinutes)} min ${deltaMinutes >= 0 ? "from now" : "ago"}`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 48) {
    return `${Math.abs(deltaHours)} hr ${deltaHours >= 0 ? "from now" : "ago"}`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? "" : "s"} ${deltaDays >= 0 ? "from now" : "ago"}`;
}

function getDurationLabel(protocol: WatchProtocolRow) {
  if (protocol.duration_rule?.trim()) {
    return protocol.duration_rule;
  }
  const steps = protocol.rule_definition_json?.steps ?? [];
  const totalMinutes = steps.reduce((sum, step) => sum + (step.duration_minutes ?? 0), 0);
  if (!totalMinutes) return "Duration not defined";
  if (totalMinutes % 60 === 0) {
    return `${totalMinutes / 60} hour${totalMinutes / 60 === 1 ? "" : "s"}`;
  }
  return `${totalMinutes} minutes`;
}

export default function ResidentAssuranceWatchCenterPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [protocols, setProtocols] = useState<WatchProtocolRow[]>([]);
  const [instances, setInstances] = useState<WatchInstanceRow[]>([]);
  const [events, setEvents] = useState<WatchEventRow[]>([]);
  const [taskSummaryByWatch, setTaskSummaryByWatch] = useState<Record<string, WatchTaskSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setProtocols([]);
      setInstances([]);
      setEvents([]);
      setTaskSummaryByWatch({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setActionError(null);

    try {
      const [protocolsRes, instancesRes, eventsRes] = await Promise.all([
        supabase
          .from("resident_watch_protocols")
          .select("id, name, trigger_type, duration_rule, approval_required, active, rule_definition_json")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("active", { ascending: false })
          .order("name", { ascending: true }),
        supabase
          .from("resident_watch_instances")
          .select(`
            id,
            resident_id,
            protocol_id,
            triggered_by_type,
            starts_at,
            ends_at,
            status,
            end_reason,
            resident_watch_protocols(name, trigger_type, approval_required),
            residents(first_name, last_name, preferred_name, room_number)
          `)
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("starts_at", { ascending: false })
          .limit(60),
        supabase
          .from("resident_watch_events")
          .select(`
            id,
            watch_instance_id,
            event_type,
            occurred_at,
            note,
            residents(first_name, last_name, preferred_name, room_number)
          `)
          .eq("facility_id", selectedFacilityId)
          .order("occurred_at", { ascending: false })
          .limit(20),
      ]);

      if (protocolsRes.error) throw protocolsRes.error;
      if (instancesRes.error) throw instancesRes.error;
      if (eventsRes.error) throw eventsRes.error;

      const watchRows = (instancesRes.data ?? []) as unknown as WatchInstanceRow[];
      setProtocols((protocolsRes.data ?? []) as unknown as WatchProtocolRow[]);
      setInstances(watchRows);
      setEvents((eventsRes.data ?? []) as unknown as WatchEventRow[]);

      if (watchRows.length === 0) {
        setTaskSummaryByWatch({});
      } else {
        const watchIds = watchRows.map((row) => row.id);
        const { data: taskRows, error: taskError } = await supabase
          .from("resident_observation_tasks")
          .select("watch_instance_id, status")
          .in("watch_instance_id", watchIds)
          .is("deleted_at", null);

        if (taskError) throw taskError;

        const byWatch = ((taskRows ?? []) as unknown as TaskAggregateRow[]).reduce<Record<string, WatchTaskSummary>>((acc, row) => {
          if (!row.watch_instance_id) return acc;
          const existing = acc[row.watch_instance_id] ?? { total: 0, open: 0, overdue: 0, missed: 0 };
          existing.total += 1;
          if (OPEN_TASK_STATUSES.has(row.status)) existing.open += 1;
          if (row.status === "overdue" || row.status === "critically_overdue") existing.overdue += 1;
          if (row.status === "missed") existing.missed += 1;
          acc[row.watch_instance_id] = existing;
          return acc;
        }, {});

        setTaskSummaryByWatch(byWatch);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load watch center");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const pending = instances.filter((row) => row.status === "pending_approval").length;
    const active = instances.filter((row) => row.status === "active").length;
    const paused = instances.filter((row) => row.status === "paused").length;
    const overdueTasks = Object.values(taskSummaryByWatch).reduce((sum, row) => sum + row.overdue + row.missed, 0);
    return {
      activeProtocols: protocols.filter((row) => row.active).length,
      pendingApprovals: pending,
      activeWatches: active,
      pausedWatches: paused,
      overdueTasks,
    };
  }, [instances, protocols, taskSummaryByWatch]);

  const actionableInstances = useMemo(
    () => instances.filter((row) => row.status === "pending_approval" || row.status === "active" || row.status === "paused"),
    [instances],
  );

  const runAction = useCallback(async (watchId: string, action: "approve" | "pause" | "resume" | "end" | "cancel") => {
    setActionLoading(`${watchId}:${action}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/rounding/watch-instances/${watchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          reason: reasonDrafts[watchId]?.trim() || undefined,
        }),
      });

      const json = (await response.json()) as { error?: string; excusedTaskCount?: number };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not update watch instance");
      }

      const suffix =
        json.excusedTaskCount && json.excusedTaskCount > 0
          ? ` ${json.excusedTaskCount} future task${json.excusedTaskCount === 1 ? "" : "s"} excused.`
          : "";
      setActionMessage(`${ACTION_LABELS[`watch_${action === "cancel" ? "cancelled" : action === "end" ? "ended" : action === "resume" ? "resumed" : action === "pause" ? "paused" : "approved"}`] ?? "Watch updated"}.${suffix}`);
      setReasonDrafts((current) => ({ ...current, [watchId]: "" }));
      await load();
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : "Could not update watch instance");
    } finally {
      setActionLoading(null);
    }
  }, [load, reasonDrafts]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix
        hasCriticals={summary.pendingApprovals > 0 || summary.overdueTasks > 0}
        primaryClass="bg-amber-700/10"
        secondaryClass="bg-cyan-900/10"
      />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
              SYS: Watch Center
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Watch Protocols
              {summary.pendingApprovals > 0 || summary.overdueTasks > 0 ? <ShieldAlert className="h-8 w-8 text-amber-400" /> : null}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-3xl">
              Review active watch protocols, approve auto-triggered monitoring, and close the loop on resident-specific safety watches.
            </p>
          </div>
          <div>
            <RoundingHubNav />
          </div>
        </div>

        {!selectedFacilityId ? (
          <div className="rounded-[2rem] border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 px-6 py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            Select a facility in the admin header to open the watch center.
          </div>
        ) : null}

        {actionMessage ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        ) : null}
        {actionError ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {actionError}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <WatchMetricCard label="Active Protocols" value={String(summary.activeProtocols)} accent="text-cyan-500" icon={<Shield className="h-5 w-5" />} />
          <WatchMetricCard label="Pending Approval" value={String(summary.pendingApprovals)} accent="text-amber-500" icon={<Clock3 className="h-5 w-5" />} pulse={summary.pendingApprovals > 0} />
          <WatchMetricCard label="Active Watches" value={String(summary.activeWatches)} accent="text-emerald-500" icon={<Activity className="h-5 w-5" />} />
          <WatchMetricCard label="Paused Watches" value={String(summary.pausedWatches)} accent="text-slate-400" icon={<PauseCircle className="h-5 w-5" />} />
          <WatchMetricCard label="Overdue Tasks" value={String(summary.overdueTasks)} accent="text-rose-500" icon={<ShieldAlert className="h-5 w-5" />} pulse={summary.overdueTasks > 0} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <V2Card hoverColor="cyan" className="p-6 border-cyan-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Actionable watch instances</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                  Pending, active, and paused watches tied to live resident monitoring.
                </p>
              </div>
              <Link href="/admin/rounding/live" className="text-xs font-bold uppercase tracking-widest text-cyan-600 dark:text-cyan-300">
                Open live board
              </Link>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
              </div>
            ) : actionableInstances.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-10 text-center text-sm text-slate-500 dark:text-zinc-500">
                No actionable watch instances in this facility.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {actionableInstances.map((row) => {
                  const residentName = row.residents ? formatResidentName(row.residents) : row.resident_id.slice(0, 8);
                  const taskSummary = taskSummaryByWatch[row.id] ?? { total: 0, open: 0, overdue: 0, missed: 0 };
                  const statusStyle = STATUS_STYLES[row.status];
                  const actionKey = (action: string) => `${row.id}:${action}`;

                  return (
                    <div key={row.id} className="rounded-[1.75rem] border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest", statusStyle.className)}>
                              {statusStyle.label}
                            </span>
                            <span className="rounded-full border border-slate-200 dark:border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">
                              {row.triggered_by_type.replace(/_/g, " ")}
                            </span>
                            {row.resident_watch_protocols?.approval_required ? (
                              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                                Approval required
                              </span>
                            ) : null}
                          </div>
                          <div>
                            <h3 className="text-xl font-display tracking-tight text-slate-900 dark:text-slate-100">{residentName}</h3>
                            <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                              {row.residents?.room_number ? `Room ${row.residents.room_number} · ` : ""}
                              {row.resident_watch_protocols?.name ?? "Watch protocol"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-5 text-sm text-slate-600 dark:text-zinc-400">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Started</p>
                              <p>{new Date(row.starts_at).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Ends</p>
                              <p>{row.ends_at ? `${new Date(row.ends_at).toLocaleString()} (${formatRelativeWindow(row.ends_at)})` : "Open-ended"}</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid min-w-[220px] grid-cols-2 gap-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 p-4 text-sm">
                          <WatchStat label="Open tasks" value={String(taskSummary.open)} />
                          <WatchStat label="Overdue" value={String(taskSummary.overdue)} danger={taskSummary.overdue > 0} />
                          <WatchStat label="Missed" value={String(taskSummary.missed)} danger={taskSummary.missed > 0} />
                          <WatchStat label="Total tasks" value={String(taskSummary.total)} />
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        <textarea
                          value={reasonDrafts[row.id] ?? ""}
                          onChange={(event) =>
                            setReasonDrafts((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="Optional note for this watch action..."
                          className="w-full rounded-2xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-500/10"
                        />

                        <div className="flex flex-wrap gap-2">
                          {row.status === "pending_approval" ? (
                            <>
                              <Button
                                type="button"
                                onClick={() => void runAction(row.id, "approve")}
                                disabled={actionLoading === actionKey("approve")}
                                className="rounded-full bg-emerald-600 text-white hover:bg-emerald-500"
                              >
                                {actionLoading === actionKey("approve") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Approve watch
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "cancel")}
                                disabled={actionLoading === actionKey("cancel")}
                                className="rounded-full"
                              >
                                {actionLoading === actionKey("cancel") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Cancel
                              </Button>
                            </>
                          ) : null}

                          {row.status === "active" ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "pause")}
                                disabled={actionLoading === actionKey("pause")}
                                className="rounded-full"
                              >
                                {actionLoading === actionKey("pause") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />}
                                Pause
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "end")}
                                disabled={actionLoading === actionKey("end")}
                                className="rounded-full"
                              >
                                {actionLoading === actionKey("end") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
                                End watch
                              </Button>
                            </>
                          ) : null}

                          {row.status === "paused" ? (
                            <>
                              <Button
                                type="button"
                                onClick={() => void runAction(row.id, "resume")}
                                disabled={actionLoading === actionKey("resume")}
                                className="rounded-full bg-cyan-600 text-white hover:bg-cyan-500"
                              >
                                {actionLoading === actionKey("resume") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                                Resume watch
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "end")}
                                disabled={actionLoading === actionKey("end")}
                                className="rounded-full"
                              >
                                {actionLoading === actionKey("end") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
                                End watch
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </V2Card>

          <div className="space-y-6">
            <V2Card hoverColor="amber" className="p-6 border-amber-500/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Protocol catalog</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                    Facility-level watch definitions used for auto-triggered and manual monitoring.
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                </div>
              ) : protocols.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-8 text-center text-sm text-slate-500 dark:text-zinc-500">
                  No watch protocols found for this facility.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {protocols.map((protocol) => (
                    <div key={protocol.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{protocol.name}</h3>
                          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                            {protocol.trigger_type.replace(/_/g, " ")} · {getDurationLabel(protocol)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
                            protocol.active
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              : "border-slate-500/30 bg-slate-500/10 text-slate-300",
                          )}
                        >
                          {protocol.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
                        <span>{protocol.approval_required ? "Requires approval" : "Auto-activates"}</span>
                        <span>•</span>
                        <span>{protocol.rule_definition_json?.steps?.length ?? 0} step{(protocol.rule_definition_json?.steps?.length ?? 0) === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </V2Card>

            <V2Card hoverColor="rose" className="p-6 border-rose-500/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent watch events</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                    Recent approvals, auto-triggers, pauses, resumptions, and watch closures.
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-rose-400" />
                </div>
              ) : events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-8 text-center text-sm text-slate-500 dark:text-zinc-500">
                  No watch events have been recorded yet.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {events.map((event) => {
                    const residentName = event.residents ? formatResidentName(event.residents) : event.watch_instance_id.slice(0, 8);
                    return (
                      <div key={event.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {ACTION_LABELS[event.event_type] ?? event.event_type.replace(/_/g, " ")}
                            </p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                              {residentName}
                              {event.residents?.room_number ? ` · Room ${event.residents.room_number}` : ""}
                            </p>
                          </div>
                          <div className="text-right text-xs text-slate-500 dark:text-zinc-500">
                            <div>{new Date(event.occurred_at).toLocaleString()}</div>
                            <div>{formatRelativeWindow(event.occurred_at)}</div>
                          </div>
                        </div>
                        {event.note ? (
                          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">{event.note}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </V2Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function WatchMetricCard({
  label,
  value,
  accent,
  icon,
  pulse = false,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <V2Card hoverColor="cyan" className="p-5 border-slate-200 dark:border-white/5">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className={cn("flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest", accent)}>
          {icon}
          {label}
          {pulse ? <span className="ml-auto h-2 w-2 rounded-full bg-rose-500" /> : null}
        </div>
        <div className={cn("text-4xl font-display tracking-tight", accent)}>{value}</div>
      </div>
    </V2Card>
  );
}

function WatchStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-xl font-display tracking-tight text-slate-900 dark:text-slate-100", danger && "text-rose-500 dark:text-rose-300")}>{value}</p>
    </div>
  );
}
