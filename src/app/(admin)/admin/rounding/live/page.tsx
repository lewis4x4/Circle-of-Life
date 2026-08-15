"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Clock3,
  Eye,
  Play,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { QuickCheckDrawer, type QuickCheckTask } from "@/components/rounding/QuickCheckDrawer";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  describeColDiscoveryCadenceForFacility,
  describeLiveBoardCadenceReminder,
  describeLiveBoardEmptyState,
} from "@/lib/rounding/col-discovery-round-cadence";
import { formatLiveRoundingShiftType } from "@/lib/rounding/live-rounding-display-copy";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type LiveTaskRow = {
  id: string;
  due_at: string;
  status: string;
  residents?: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    room_number?: string | null;
  } | null;
  staff?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  shift_assignments?: { shift_type: string | null } | null;
};

type StatusFilter = "all" | "critical" | "overdue" | "pending" | "completed" | "late";

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState =
  | "no_facility"
  | "loading"
  | "error"
  | "empty_no_cycle"
  | "empty_filtered"
  | "populated";

type Tone = "default" | "warning" | "danger";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const AUTO_REFRESH_INTERVAL_MS = 30_000; // 30s — balances signal vs load on med carts
const STATUS_TICK_INTERVAL_MS = 1_000;
const TASK_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function displayName(person?: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null]
    .filter(Boolean)
    .join(" ");
}

function statusConfig(status: string) {
  if (status === "critically_overdue" || status === "missed")
    return {
      label: "Critical",
      icon: AlertTriangle,
      tone: "danger" as Tone,
      filterGroup: "critical" as StatusFilter,
    };
  if (status === "overdue")
    return {
      label: "Overdue",
      icon: Clock3,
      tone: "warning" as Tone,
      filterGroup: "overdue" as StatusFilter,
    };
  if (status === "completed_on_time")
    return {
      label: "On time",
      icon: CheckCircle2,
      tone: "default" as Tone,
      filterGroup: "completed" as StatusFilter,
    };
  if (status === "completed_late")
    return {
      label: "Late",
      icon: Clock,
      tone: "warning" as Tone,
      filterGroup: "late" as StatusFilter,
    };
  if (status === "excused")
    return {
      label: "Excused",
      icon: UserRound,
      tone: "default" as Tone,
      filterGroup: "all" as StatusFilter,
    };
  return {
    label: "Pending",
    icon: Eye,
    tone: "default" as Tone,
    filterGroup: "pending" as StatusFilter,
  };
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

function formatRelativeAgo(ts: number | null, now: number): string {
  if (ts == null) return "just now";
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function isActionable(status: string) {
  return !status.startsWith("completed") && status !== "excused";
}

function toDrawerTask(task: LiveTaskRow): QuickCheckTask {
  const room = (task.residents as LiveTaskRow["residents"] & { room_number?: string | null })?.room_number;
  return {
    id: task.id,
    residentName: displayName(task.residents) || "Resident",
    roomLabel: room ? `RM ${room}` : null,
    dueAt: task.due_at,
    status: task.status,
  };
}

/* -------------------------------------------------------------------------- */
/*  Value-derived tone resolvers — color derives from value, never style      */
/* -------------------------------------------------------------------------- */

function resolveCriticalTone(count: number): Tone {
  return count > 0 ? "danger" : "default";
}

function resolveOverdueTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 3) return "warning";
  return "danger";
}

// Pending and Completed counts are informational — they stay neutral regardless
// of value. Keeping these as functions so future tuning (e.g. tinted-green at
// 100% on-time rate) follows the same pattern as Critical/Overdue.
function resolvePendingTone(): Tone {
  return "default";
}

function resolveCompletedTone(): Tone {
  return "default";
}

/* -------------------------------------------------------------------------- */
/*  Board state derivation                                                     */
/* -------------------------------------------------------------------------- */

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
  totalTasks: number;
  filteredTasks: number;
  filterApplied: boolean;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.totalTasks === 0) return "empty_no_cycle";
  if (args.filterApplied && args.filteredTasks === 0) return "empty_filtered";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function AdminRoundingLivePage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [tasks, setTasks] = useState<LiveTaskRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTask, setDrawerTask] = useState<QuickCheckTask | null>(null);
  const [sequentialMode, setSequentialMode] = useState(false);
  const [sequentialIndex, setSequentialIndex] = useState(0);

  const loadingRef = useRef(false);

  const facilityName = useMemo(() => {
    if (!selectedFacilityId) return null;
    return (
      availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null
    );
  }, [availableFacilities, selectedFacilityId]);

  const emptyCopy = useMemo(
    () => describeLiveBoardEmptyState(facilityName),
    [facilityName],
  );

  const cadenceReminder = useMemo(
    () => (facilityName ? describeLiveBoardCadenceReminder(facilityName) : null),
    [facilityName],
  );

  const cadenceHeadline = useMemo(
    () =>
      facilityName ? describeColDiscoveryCadenceForFacility(facilityName).headline : null,
    [facilityName],
  );

  const load = useCallback(async () => {
    // Prevent overlap from auto-refresh ticks colliding with manual refresh.
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadState((prev) => (prev === "idle" ? "loading" : prev));
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setTasks([]);
      setLoadState("ready");
      loadingRef.current = false;
      return;
    }

    try {
      const { data, error } = await supabase
        .from("resident_observation_tasks")
        .select(
          "id, due_at, status, residents ( first_name, last_name, preferred_name, room_number ), staff:assigned_staff_id ( first_name, last_name, preferred_name ), shift_assignments ( shift_type )",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("due_at", new Date(Date.now() - TASK_LOOKBACK_MS).toISOString())
        .order("due_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      const rows = (data ?? []) as unknown as LiveTaskRow[];
      setTasks(rows);
      setLoadState("ready");
      setLastUpdatedAt(Date.now());
    } catch (err) {
      setErrorMessage(
        formatLiveDataLoadError(
          err,
          "Could not load live rounding tasks. Confirm facility scope and retry.",
        ),
      );
      setLoadState("error");
    } finally {
      loadingRef.current = false;
    }
  }, [selectedFacilityId, supabase]);

  // Initial load + reload on facility change.
  useEffect(() => {
    setLoadState("loading");
    void load();
  }, [load]);

  // Auto-refresh every 30s while facility selected and tab is visible.
  useEffect(() => {
    if (!selectedFacilityId) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, selectedFacilityId]);

  // 1s tick to keep "Live · last update Xs ago" timestamp fresh.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), STATUS_TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  /* ------------------------------- Derived ------------------------------- */

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return sorted;
    if (statusFilter === "critical")
      return sorted.filter((t) => t.status === "critically_overdue" || t.status === "missed");
    if (statusFilter === "overdue") return sorted.filter((t) => t.status === "overdue");
    if (statusFilter === "pending")
      return sorted.filter(
        (t) =>
          isActionable(t.status) &&
          t.status !== "overdue" &&
          t.status !== "critically_overdue" &&
          t.status !== "missed",
      );
    if (statusFilter === "completed")
      return sorted.filter((t) => t.status === "completed_on_time");
    if (statusFilter === "late") return sorted.filter((t) => t.status === "completed_late");
    return sorted;
  }, [sorted, statusFilter]);

  const actionableQueue = useMemo(
    () => sorted.filter((t) => isActionable(t.status)),
    [sorted],
  );

  const criticalCount = sorted.filter(
    (t) => t.status === "critically_overdue" || t.status === "missed",
  ).length;
  const overdueCount = sorted.filter((t) => t.status === "overdue").length;
  const pendingCount = sorted.filter(
    (t) =>
      isActionable(t.status) &&
      t.status !== "overdue" &&
      t.status !== "critically_overdue" &&
      t.status !== "missed",
  ).length;
  const completedCount = sorted.filter((t) => t.status.startsWith("completed")).length;
  const lateCount = sorted.filter((t) => t.status === "completed_late").length;
  const onTimeCount = completedCount - lateCount;

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    totalTasks: sorted.length,
    filteredTasks: filteredTasks.length,
    filterApplied: statusFilter !== "all",
  });

  /* ------------------------------- Drawer ------------------------------- */

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

  const showSequentialCta = boardState === "populated" && actionableQueue.length > 0;

  /* ------------------------------- Render ------------------------------- */

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Live rounding board"
        subtitle="Select a resident to record a check."
        actions={
          <>
            {showSequentialCta ? (
              <Button
                type="button"
                variant="default"
                size="default"
                onClick={startSequentialRounds}
              >
                <Play className="size-4" aria-hidden />
                Start sequential rounds
                <span className="ml-1 rounded-sm bg-primary-foreground/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
                  {actionableQueue.length}
                </span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh live rounding tasks"
              title="Refresh now"
              disabled={loadState === "loading"}
            >
              <RefreshCw
                className={cn("size-4", loadState === "loading" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {selectedFacilityId && cadenceReminder ? (
        <LiveBoardCadenceReminder headline={cadenceHeadline} detail={cadenceReminder} />
      ) : null}

      {/*
       * State machine — exactly one branch renders below.
       * Order matters: facility scope dominates, then loading, then error, then empties, then content.
       */}
      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load live rounding tasks."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          <LiveIndicator loadState={loadState} lastUpdatedAt={lastUpdatedAt} now={now} />

          {/* KPI strip — summary counts; value-derived tone */}
          <section aria-label="Live rounding key counts">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Critical"
                value={criticalCount}
                tone={resolveCriticalTone(criticalCount)}
                hint="Critically overdue or missed checks."
              />
              <KpiCard
                label="Overdue"
                value={overdueCount}
                tone={resolveOverdueTone(overdueCount)}
                hint="Checks past their scheduled window."
              />
              <KpiCard
                label="Pending"
                value={pendingCount}
                tone={resolvePendingTone()}
                hint="Checks due within the current window."
              />
              <KpiCard
                label="Completed today"
                value={completedCount}
                tone={resolveCompletedTone()}
                hint={`On time: ${onTimeCount} · Late: ${lateCount}`}
              />
            </div>
          </section>

          {/* Filter pills — drill-down; mute at default state */}
          <section aria-label="Filter live tasks">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                Filter
              </span>
              <div className="-mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 md:overflow-visible md:pb-0">
                <FilterPill
                  label="All"
                  count={sorted.length}
                  tone="default"
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                />
                <FilterPill
                  label="Critical"
                  count={criticalCount}
                  tone={resolveCriticalTone(criticalCount)}
                  active={statusFilter === "critical"}
                  onClick={() =>
                    setStatusFilter(statusFilter === "critical" ? "all" : "critical")
                  }
                />
                <FilterPill
                  label="Overdue"
                  count={overdueCount}
                  tone={resolveOverdueTone(overdueCount)}
                  active={statusFilter === "overdue"}
                  onClick={() =>
                    setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")
                  }
                />
                <FilterPill
                  label="Pending"
                  count={pendingCount}
                  tone={resolvePendingTone()}
                  active={statusFilter === "pending"}
                  onClick={() =>
                    setStatusFilter(statusFilter === "pending" ? "all" : "pending")
                  }
                />
                <FilterPill
                  label="Completed"
                  count={completedCount}
                  tone="default"
                  active={statusFilter === "completed" || statusFilter === "late"}
                  onClick={() =>
                    setStatusFilter(statusFilter === "completed" ? "all" : "completed")
                  }
                />
                {(statusFilter === "completed" || statusFilter === "late") && (
                  <>
                    <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                    <FilterPill
                      label="On time"
                      count={onTimeCount}
                      tone="default"
                      active={statusFilter === "completed"}
                      onClick={() => setStatusFilter("completed")}
                      compact
                    />
                    <FilterPill
                      label="Late"
                      count={lateCount}
                      tone="default"
                      active={statusFilter === "late"}
                      onClick={() => setStatusFilter("late")}
                      compact
                    />
                  </>
                )}
                {statusFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                    Clear filter
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Content — loading, task list, no-cycle empty, or filter-empty */}
          {boardState === "loading" ? (
            <LiveBoardLoadingNotice />
          ) : boardState === "empty_no_cycle" ? (
            <LiveBoardEmptyNotice copy={emptyCopy} />
          ) : boardState === "empty_filtered" ? (
            <FilterEmptyState onClear={() => setStatusFilter("all")} />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Live rounding tasks">
              {filteredTasks.map((task) => {
                const cfg = statusConfig(task.status);
                const canCheck = isActionable(task.status);
                const Icon = cfg.icon;
                const room = (task.residents as LiveTaskRow["residents"] & {
                  room_number?: string | null;
                })?.room_number;

                return (
                  <li key={task.id}>
                    <div
                      className={cn(
                        "group flex min-h-[64px] flex-col gap-3 rounded-lg border bg-card px-4 py-3 transition-colors md:flex-row md:items-center md:gap-4",
                        canCheck
                          ? "cursor-pointer border-border hover:border-border-strong hover:bg-muted/40"
                          : "border-border",
                      )}
                      onClick={canCheck ? () => openSingleCheck(task) : undefined}
                      role={canCheck ? "button" : undefined}
                      tabIndex={canCheck ? 0 : undefined}
                      onKeyDown={
                        canCheck
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openSingleCheck(task);
                              }
                            }
                          : undefined
                      }
                      aria-label={
                        canCheck
                          ? `Check in ${displayName(task.residents) || "Resident"}`
                          : undefined
                      }
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-md border",
                          cfg.tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
                          cfg.tone === "warning" &&
                            "border-warning/40 bg-warning/10 text-warning",
                          cfg.tone === "default" && "border-border bg-muted text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="truncate text-[15px] font-semibold text-foreground">
                            {displayName(task.residents) || "Resident"}
                          </span>
                          {room ? (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                              Room {room}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {displayName(task.staff) || "Unassigned"}
                          <span aria-hidden className="px-1.5 text-border">·</span>
                          {formatLiveRoundingShiftType(task.shift_assignments?.shift_type)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:justify-end">
                        <div className="text-left md:text-right">
                          <p
                            className={cn(
                              "text-[12px] font-semibold tabular-nums",
                              cfg.tone === "danger" && "text-danger",
                              cfg.tone === "warning" && "text-warning",
                              cfg.tone === "default" && "text-foreground",
                            )}
                          >
                            {formatDueLabel(task.due_at)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "mt-0.5 text-[11px] font-medium",
                              cfg.tone === "danger" && "border-danger/40 text-danger",
                              cfg.tone === "warning" && "border-warning/40 text-warning",
                            )}
                          >
                            {cfg.label}
                          </Badge>
                        </div>
                        {canCheck && (
                          <span
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                              "pointer-events-none shrink-0 group-hover:bg-muted",
                            )}
                            aria-hidden
                          >
                            Check in
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <QuickCheckDrawer
        task={drawerTask}
        open={drawerOpen}
        onClose={handleDrawerClose}
        onCompleted={handleCompleted}
        queuePosition={
          sequentialMode
            ? { current: sequentialIndex + 1, total: actionableQueue.length }
            : null
        }
        onNextTask={sequentialMode ? advanceSequential : undefined}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  KPI card — value-derived tone, sentence case label                        */
/* -------------------------------------------------------------------------- */

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
  return (
    <article
      aria-label={`${label}: ${value}`}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3",
        tone === "danger" && "border-danger/40",
        tone === "warning" && "border-warning/40",
        tone === "default" && "border-border",
      )}
      data-tone={tone}
    >
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter pill — three states: muted, subtle-tinted, active                  */
/* -------------------------------------------------------------------------- */

function FilterPill({
  label,
  count,
  tone,
  active,
  onClick,
  compact,
}: {
  label: string;
  count: number;
  tone: Tone;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  // Color is reserved for non-default states. A zero count + inactive renders muted.
  const showSemanticTint = tone !== "default" && count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "px-2 py-1" : "px-2.5 py-1.5",
        active && tone === "danger" && "border-danger bg-danger/10 text-danger",
        active && tone === "warning" && "border-warning bg-warning/10 text-warning",
        active && tone === "default" && "border-border-strong bg-muted text-foreground",
        !active &&
          showSemanticTint &&
          tone === "danger" &&
          "border-danger/30 bg-card text-danger hover:bg-danger/5",
        !active &&
          showSemanticTint &&
          tone === "warning" &&
          "border-warning/30 bg-card text-warning hover:bg-warning/5",
        !active &&
          !showSemanticTint &&
          "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className={cn("tabular-nums opacity-80", active && "opacity-100")}>({count})</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Live indicator — auto-refresh visualization                                */
/* -------------------------------------------------------------------------- */

function LiveIndicator({
  loadState,
  lastUpdatedAt,
  now,
}: {
  loadState: LoadState;
  lastUpdatedAt: number | null;
  now: number;
}) {
  const isLoading = loadState === "loading";
  const ago = formatRelativeAgo(lastUpdatedAt, now);

  return (
    <div
      className="flex items-center gap-2 text-[12px] text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <LivePulseDot active={!isLoading} />
      <span className="font-medium text-foreground">Live</span>
      <span aria-hidden className="text-border">·</span>
      <span>
        {isLoading && lastUpdatedAt == null ? "Loading…" : `Last updated ${ago}`}
      </span>
    </div>
  );
}

function LivePulseDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex size-2 shrink-0 items-center justify-center"
    >
      {active && (
        <span className="absolute inline-flex size-2 animate-ping rounded-full bg-success/60" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty states + interstitials                                              */
/* -------------------------------------------------------------------------- */

function AllFacilitiesInterstitial() {
  const copy = describeLiveBoardEmptyState(null);

  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-muted/20 p-3"
      role="status"
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{copy.why}</span>
        {" — "}
        {copy.guidance}
      </p>
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

function LiveBoardCadenceReminder({
  headline,
  detail,
}: {
  headline: string | null;
  detail: string;
}) {
  return (
    <section
      aria-label="Jessica discovery cadence reminder"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {headline ? (
          <span className="font-medium text-foreground">{headline}</span>
        ) : null}
        {headline ? " — " : null}
        {detail}
      </p>
    </section>
  );
}

function LiveBoardLoadingNotice() {
  return (
    <section
      aria-label="Loading live rounding tasks"
      className="rounded-lg border border-dashed border-border bg-muted/20 p-3"
      role="status"
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Loading live rounding tasks…
      </p>
    </section>
  );
}

function LiveBoardEmptyNotice({ copy }: { copy: ReturnType<typeof describeLiveBoardEmptyState> }) {
  return (
    <section
      aria-label="No live rounding tasks"
      className="rounded-lg border border-dashed border-border bg-muted/20 p-3"
      role="status"
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{copy.why}</span>
        {" "}
        {copy.guidance}
        {" "}
        <Link
          href="/admin/rounding"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {copy.overviewCta}
        </Link>
        .
      </p>
    </section>
  );
}

function FilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      aria-label="No tasks match filter"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <Clock className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No checks match the current filter
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the filter, or wait for the next scheduled window.
      </p>
      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" aria-hidden />
          Clear filters
        </Button>
      </div>
    </section>
  );
}
