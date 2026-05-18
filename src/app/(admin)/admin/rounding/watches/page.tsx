"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Eye,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Shield,
  StopCircle,
  X,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterPill } from "@/components/ui/filter-pill";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState = "no_facility" | "loading" | "error" | "populated";

type Tone = "default" | "warning" | "danger";
type WatchFilter = "all" | "pending" | "active" | "closed_today" | "paused";

/* -------------------------------------------------------------------------- */
/*  Constants + helpers                                                       */
/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<WatchStatus, Tone> = {
  pending_approval: "warning",
  active: "default",
  paused: "default",
  ended: "default",
  cancelled: "danger",
};

const STATUS_LABEL: Record<WatchStatus, string> = {
  pending_approval: "Pending approval",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  cancelled: "Cancelled",
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
  if (protocol.duration_rule?.trim()) return protocol.duration_rule;
  const steps = protocol.rule_definition_json?.steps ?? [];
  const totalMinutes = steps.reduce((sum, step) => sum + (step.duration_minutes ?? 0), 0);
  if (!totalMinutes) return "Duration not defined";
  if (totalMinutes % 60 === 0) {
    return `${totalMinutes / 60} hour${totalMinutes / 60 === 1 ? "" : "s"}`;
  }
  return `${totalMinutes} minutes`;
}

function resolvePendingTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 2) return "warning";
  return "danger";
}

function resolveOverdueTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 3) return "warning";
  return "danger";
}

function toStatusPillTone(tone: Tone) {
  if (tone === "danger") return "danger" as const;
  if (tone === "warning") return "warning" as const;
  return "muted" as const;
}

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function SmartRoundingWatchesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find((facility) => facility.id === selectedFacilityId);
  const facilityName = selectedFacility?.name ?? "selected facility";
  const [protocols, setProtocols] = useState<WatchProtocolRow[]>([]);
  const [instances, setInstances] = useState<WatchInstanceRow[]>([]);
  const [events, setEvents] = useState<WatchEventRow[]>([]);
  const [taskSummaryByWatch, setTaskSummaryByWatch] = useState<Record<string, WatchTaskSummary>>(
    {},
  );
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<WatchFilter>("all");
  const [pendingApproval, setPendingApproval] = useState<WatchInstanceRow | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    setActionError(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setProtocols([]);
      setInstances([]);
      setEvents([]);
      setTaskSummaryByWatch({});
      setLoadState("ready");
      return;
    }

    try {
      const [protocolsRes, instancesRes, eventsRes] = await Promise.all([
        supabase
          .from("resident_watch_protocols")
          .select(
            "id, name, trigger_type, duration_rule, approval_required, active, rule_definition_json",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("active", { ascending: false })
          .order("name", { ascending: true }),
        supabase
          .from("resident_watch_instances")
          .select(
            `
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
          `,
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("starts_at", { ascending: false })
          .limit(60),
        supabase
          .from("resident_watch_events")
          .select(
            `
            id,
            watch_instance_id,
            event_type,
            occurred_at,
            note,
            residents(first_name, last_name, preferred_name, room_number)
          `,
          )
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

        const byWatch = ((taskRows ?? []) as unknown as TaskAggregateRow[]).reduce<
          Record<string, WatchTaskSummary>
        >((acc, row) => {
          if (!row.watch_instance_id) return acc;
          const existing = acc[row.watch_instance_id] ?? {
            total: 0,
            open: 0,
            overdue: 0,
            missed: 0,
          };
          existing.total += 1;
          if (OPEN_TASK_STATUSES.has(row.status)) existing.open += 1;
          if (row.status === "overdue" || row.status === "critically_overdue") {
            existing.overdue += 1;
          }
          if (row.status === "missed") existing.missed += 1;
          acc[row.watch_instance_id] = existing;
          return acc;
        }, {});

        setTaskSummaryByWatch(byWatch);
      }

      setLoadState("ready");
    } catch {
      setErrorMessage("Could not load watches. Confirm facility scope and retry.");
      setLoadState("error");
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const pending = instances.filter((row) => row.status === "pending_approval").length;
    const active = instances.filter((row) => row.status === "active").length;
    const paused = instances.filter((row) => row.status === "paused").length;
    const overdueTasks = Object.values(taskSummaryByWatch).reduce(
      (sum, row) => sum + row.overdue + row.missed,
      0,
    );
    return {
      activeProtocols: protocols.filter((row) => row.active).length,
      pendingApprovals: pending,
      activeWatches: active,
      pausedWatches: paused,
      overdueTasks,
    };
  }, [instances, protocols, taskSummaryByWatch]);

  const runAction = useCallback(
    async (
      watchId: string,
      action: "approve" | "pause" | "resume" | "end" | "cancel",
    ) => {
      setActionLoading(`${watchId}:${action}`);
      setActionError(null);
      setActionMessage(null);

      try {
        const response = await fetch(`/api/rounding/watch-instances/${watchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason: reasonDrafts[watchId]?.trim() || undefined,
          }),
        });

        const json = (await response.json()) as {
          error?: string;
          excusedTaskCount?: number;
        };
        if (!response.ok) {
          throw new Error(json.error ?? "Could not update watch instance");
        }

        const verb =
          action === "approve"
            ? "Approved"
            : action === "pause"
              ? "Paused"
              : action === "resume"
                ? "Resumed"
                : action === "end"
                  ? "Ended"
                  : "Cancelled";
        const suffix =
          json.excusedTaskCount && json.excusedTaskCount > 0
            ? ` ${json.excusedTaskCount} future task${json.excusedTaskCount === 1 ? "" : "s"} excused.`
            : "";
        setActionMessage(`${verb}.${suffix}`);
        setReasonDrafts((current) => ({ ...current, [watchId]: "" }));
        await load();
      } catch {
        setActionError("Could not update watch. Confirm the watch is still actionable and retry.");
      } finally {
        setActionLoading(null);
      }
    },
    [load, reasonDrafts],
  );

  const watchCounts = useMemo(() => {
    const today = new Date().toDateString();
    return {
      all: instances.length,
      pending: instances.filter((row) => row.status === "pending_approval").length,
      active: instances.filter((row) => row.status === "active").length,
      closed_today: instances.filter((row) => (row.status === "ended" || row.status === "cancelled") && row.ends_at && new Date(row.ends_at).toDateString() === today).length,
      paused: instances.filter((row) => row.status === "paused").length,
    };
  }, [instances]);

  const filteredInstances = useMemo(() => {
    if (filter === "all") return instances;
    if (filter === "pending") return instances.filter((row) => row.status === "pending_approval");
    if (filter === "active") return instances.filter((row) => row.status === "active");
    if (filter === "paused") return instances.filter((row) => row.status === "paused");
    const today = new Date().toDateString();
    return instances.filter((row) => (row.status === "ended" || row.status === "cancelled") && row.ends_at && new Date(row.ends_at).toDateString() === today);
  }, [filter, instances]);

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Watches"
        subtitle={`Review active watches, approve auto-triggered monitoring, and close the loop on resident-specific safety protocols at ${facilityName}.`}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh watch center"
            title="Refresh"
            disabled={loadState === "loading"}
          >
            <RefreshCw
              className={cn("size-4", loadState === "loading" && "animate-spin")}
              aria-hidden
            />
          </Button>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load watch center."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {actionMessage ? (
            <InfoBanner
              tone="success"
              message={actionMessage}
              onDismiss={() => setActionMessage(null)}
            />
          ) : null}
          {actionError ? (
            <InfoBanner
              tone="error"
              message={actionError}
              onDismiss={() => setActionError(null)}
            />
          ) : null}

          {/* KPI strip */}
          <section aria-label="Watch summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard
                label="Active protocols"
                value={summary.activeProtocols}
                tone="default"
                hint="Facility-level watch definitions"
              />
              <KpiCard
                label="Pending approval"
                value={summary.pendingApprovals}
                tone={resolvePendingTone(summary.pendingApprovals)}
                hint="Awaiting supervisor sign-off"
              />
              <KpiCard
                label="Active watches"
                value={summary.activeWatches}
                tone="default"
                hint="Currently monitoring residents"
              />
              <KpiCard
                label="Paused watches"
                value={summary.pausedWatches}
                tone="default"
                hint="Temporarily paused"
              />
              <KpiCard
                label="Overdue tasks"
                value={summary.overdueTasks}
                tone={resolveOverdueTone(summary.overdueTasks)}
                hint="Across active watches"
              />
            </div>
          </section>

          <section aria-label="Filter watches">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterPill label="All" count={watchCounts.all} active={filter === "all"} onClick={() => setFilter("all")} />
              <FilterPill label="Pending approval" count={watchCounts.pending} tone="warning" active={filter === "pending"} onClick={() => setFilter(filter === "pending" ? "all" : "pending")} />
              <FilterPill label="Active" count={watchCounts.active} active={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")} />
              <FilterPill label="Closed today" count={watchCounts.closed_today} active={filter === "closed_today"} onClick={() => setFilter(filter === "closed_today" ? "all" : "closed_today")} />
              <FilterPill label="Paused" count={watchCounts.paused} active={filter === "paused"} onClick={() => setFilter(filter === "paused" ? "all" : "paused")} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
            {/* Actionable watch instances */}
            <section
              aria-label="Actionable watch instances"
              className="rounded-lg border border-border bg-card"
            >
              <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Actionable watch instances
                  </h2>
                  <p className="text-[12px] text-muted-foreground">
                    Pending, active, and paused watches tied to live resident monitoring.
                  </p>
                </div>
                <Link
                  href="/admin/rounding/live"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground hover:underline"
                >
                  <Eye className="size-3.5" aria-hidden />
                  Open live board
                </Link>
              </header>

              {filteredInstances.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Shield className="mx-auto size-7 text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No watches at {facilityName}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Watches are created automatically when clinical triggers fire, or manually from a resident profile.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredInstances.map((row) => {
                    const residentName = row.residents
                      ? formatResidentName(row.residents)
                      : row.resident_id.slice(0, 8);
                    const taskSummary = taskSummaryByWatch[row.id] ?? {
                      total: 0,
                      open: 0,
                      overdue: 0,
                      missed: 0,
                    };

                    return (
                      <li key={row.id} className="p-4">
                        <WatchInstanceRowCard
                          row={row}
                          residentName={residentName}
                          taskSummary={taskSummary}
                          reasonDraft={reasonDrafts[row.id] ?? ""}
                          onReasonChange={(value) =>
                            setReasonDrafts((current) => ({ ...current, [row.id]: value }))
                          }
                          actionLoading={actionLoading}
                          onRequestApprove={() => setPendingApproval(row)}
                          onAction={(action) => void runAction(row.id, action)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Right column: protocol catalog + events */}
            <div className="space-y-4">
              <section
                aria-label="Protocol catalog"
                className="rounded-lg border border-border bg-card"
              >
                <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Protocol catalog</h2>
                    <p className="text-[12px] text-muted-foreground">
                      Facility-level watch definitions.
                    </p>
                  </div>
                </header>

                {loadState === "loading" ? (
                  <div className="flex items-center justify-center px-4 py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : protocols.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                    No watch protocols configured for this facility.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {protocols.map((protocol) => (
                      <li key={protocol.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">
                              {protocol.name}
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground capitalize">
                              {protocol.trigger_type.replace(/_/g, " ")} ·{" "}
                              {getDurationLabel(protocol)}
                            </p>
                          </div>
                          <StatusPill value={protocol.active ? "Active" : "Inactive"} defaultValue="Active" tone={protocol.active ? "muted" : "warning"} />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {protocol.approval_required ? "Requires approval" : "Auto-activates"}
                          <span aria-hidden className="px-1.5 text-border">
                            ·
                          </span>
                          {protocol.rule_definition_json?.steps?.length ?? 0} step
                          {(protocol.rule_definition_json?.steps?.length ?? 0) === 1 ? "" : "s"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                aria-label="Recent watch events"
                className="rounded-lg border border-border bg-card"
              >
                <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Recent watch events</h2>
                    <p className="text-[12px] text-muted-foreground">
                      Approvals, auto-triggers, pauses, resumptions, closures.
                    </p>
                  </div>
                </header>

                {loadState === "loading" ? (
                  <div className="flex items-center justify-center px-4 py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : events.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                    No watch events recorded yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {events.map((event) => {
                      const residentName = event.residents
                        ? formatResidentName(event.residents)
                        : event.watch_instance_id.slice(0, 8);
                      return (
                        <li key={event.id} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {ACTION_LABELS[event.event_type] ??
                                  event.event_type.replace(/_/g, " ")}
                              </p>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {residentName}
                                {event.residents?.room_number
                                  ? ` · Room ${event.residents.room_number}`
                                  : ""}
                              </p>
                            </div>
                            <div className="text-right text-[12px] text-muted-foreground">
                              <div>{new Date(event.occurred_at).toLocaleString()}</div>
                              <div>{formatRelativeWindow(event.occurred_at)}</div>
                            </div>
                          </div>
                          {event.note ? (
                            <p className="mt-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12px] text-foreground">
                              {event.note}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
          <Dialog open={Boolean(pendingApproval)} onOpenChange={(open) => !open && setPendingApproval(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Approve watch?</DialogTitle>
                <DialogDescription>
                  {pendingApproval
                    ? `Approve watch on ${pendingApproval.residents ? formatResidentName(pendingApproval.residents) : "resident"} for ${pendingApproval.resident_watch_protocols?.name ?? pendingApproval.triggered_by_type.replace(/_/g, " ")}? This will activate monitoring per the watch protocol.`
                    : "This will activate monitoring per the watch protocol."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingApproval(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    if (!pendingApproval) return;
                    const watchId = pendingApproval.id;
                    setPendingApproval(null);
                    void runAction(watchId, "approve");
                  }}
                >
                  Approve watch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Watch instance row                                                        */
/* -------------------------------------------------------------------------- */

function WatchInstanceRowCard({
  row,
  residentName,
  taskSummary,
  reasonDraft,
  onReasonChange,
  actionLoading,
  onRequestApprove,
  onAction,
}: {
  row: WatchInstanceRow;
  residentName: string;
  taskSummary: WatchTaskSummary;
  reasonDraft: string;
  onReasonChange: (value: string) => void;
  actionLoading: string | null;
  onRequestApprove: () => void;
  onAction: (action: "approve" | "pause" | "resume" | "end" | "cancel") => void;
}) {
  const actionKey = (action: string) => `${row.id}:${action}`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={toStatusPillTone(STATUS_TONE[row.status])}>
            {STATUS_LABEL[row.status]}
          </StatusPill>
          <Chip className="border-border bg-muted text-muted-foreground">
            {row.triggered_by_type.replace(/_/g, " ")}
          </Chip>
          {row.resident_watch_protocols?.approval_required ? (
            <Chip className="border-warning/30 bg-warning/10 text-warning">
              Approval required
            </Chip>
          ) : null}
        </div>

        <div>
          <h3 className="text-base font-semibold text-foreground">{residentName}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {row.residents?.room_number ? `Room ${row.residents.room_number} · ` : ""}
            {row.resident_watch_protocols?.name ?? "Watch protocol"}
          </p>
        </div>

        <dl className="grid gap-3 text-[13px] text-foreground md:grid-cols-2">
          <DataPair label="Started" value={new Date(row.starts_at).toLocaleString()} />
          <DataPair
            label="Ends"
            value={
              row.ends_at
                ? `${new Date(row.ends_at).toLocaleString()} (${formatRelativeWindow(row.ends_at)})`
                : "Open-ended"
            }
          />
        </dl>

        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-4">
          <StatPair label="Open tasks" value={taskSummary.open} />
          <StatPair label="Overdue" value={taskSummary.overdue} danger />
          <StatPair label="Missed" value={taskSummary.missed} danger />
          <StatPair label="Total tasks" value={taskSummary.total} />
        </div>
      </div>

      <div className="min-w-0 lg:w-[260px] lg:shrink-0">
        <div className="space-y-3">
          <label htmlFor={`reason-${row.id}`} className="sr-only">
            Watch action note
          </label>
          <textarea
            id={`reason-${row.id}`}
            value={reasonDraft}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={2}
            placeholder="Optional note for this action…"
            className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />

          <div className="flex flex-wrap gap-2">
            {row.status === "pending_approval" && (
              <>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={onRequestApprove}
                  disabled={actionLoading === actionKey("approve")}
                >
                  {actionLoading === actionKey("approve") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-3.5" aria-hidden />
                  )}
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction("cancel")}
                  disabled={actionLoading === actionKey("cancel")}
                >
                  {actionLoading === actionKey("cancel") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <XCircle className="size-3.5" aria-hidden />
                  )}
                  Cancel
                </Button>
              </>
            )}

            {row.status === "active" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAction("pause")}
                  disabled={actionLoading === actionKey("pause")}
                >
                  {actionLoading === actionKey("pause") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PauseCircle className="size-3.5" aria-hidden />
                  )}
                  Pause
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction("end")}
                  disabled={actionLoading === actionKey("end")}
                >
                  {actionLoading === actionKey("end") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <StopCircle className="size-3.5" aria-hidden />
                  )}
                  End watch
                </Button>
              </>
            )}

            <Link
              href={`/admin/residents/${row.resident_id}`}
              className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              View detail
            </Link>

            {row.status === "paused" && (
              <>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => onAction("resume")}
                  disabled={actionLoading === actionKey("resume")}
                >
                  {actionLoading === actionKey("resume") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PlayCircle className="size-3.5" aria-hidden />
                  )}
                  Resume
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction("end")}
                  disabled={actionLoading === actionKey("end")}
                >
                  {actionLoading === actionKey("end") ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <StopCircle className="size-3.5" aria-hidden />
                  )}
                  End watch
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        className,
      )}
    >
      {children}
    </span>
  );
}

function DataPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function StatPair({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  const flagged = Boolean(danger) && value > 0;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          flagged ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: Tone;
  hint: string;
}) {
  const thresholds =
    label === "Pending approval" || label === "Overdue tasks"
      ? ({ type: label === "Overdue tasks" ? "overdue-count" : "critical-count" } as const)
      : ({ type: "informational" } as const);
  return <MetricCard label={label} value={value} numericValue={value} thresholds={thresholds} tone={tone === "default" ? undefined : tone} hint={hint} />;
}

/* -------------------------------------------------------------------------- */
/*  Notices + empty states                                                    */
/* -------------------------------------------------------------------------- */

function InfoBanner({
  tone,
  message,
  onDismiss,
}: {
  tone: "success" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] text-foreground",
        tone === "success" && "border-success/30 bg-success/10",
        tone === "error" && "border-destructive/30 bg-destructive/10",
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function AllFacilitiesInterstitial() {
  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-card p-6"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Watch center operates per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Watch protocols and instances are facility-scoped. Select a facility from the top
            bar to continue.
          </p>
        </div>
      </div>
    </section>
  );
}

function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
    </div>
  );
}
