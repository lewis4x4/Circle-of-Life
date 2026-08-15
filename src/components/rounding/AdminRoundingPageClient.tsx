"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Eye,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import { RoundingHubNav } from "@/app/(admin)/admin/rounding/rounding-hub-nav";
import { DiscoveryCadenceApplyPanel } from "@/components/rounding/DiscoveryCadenceApplyPanel";
import { PageHeader } from "@/design-system/components/PageHeader";
import { KPITile, type KPITileTone } from "@/design-system/components/KPITile";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  EMPTY_ROUNDING_SUMMARY,
  fetchRoundingOverviewFromSupabase,
  type RoundingOverviewSummary,
  type RoundingTaskRow,
} from "@/lib/rounding/load-rounding-overview";
import { formatLiveRoundingTimeOfDay } from "@/lib/rounding/live-rounding-display-copy";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type OverviewSummary = RoundingOverviewSummary;
type TaskRow = RoundingTaskRow;

type LoadState = "idle" | "loading" | "ready" | "error";

type StatusStripState =
  | "loading"
  | "no_rounds"
  | "in_progress"
  | "completed"
  | "error";

/* -------------------------------------------------------------------------- */
/*  Threshold helpers — semantic color derives from value, never from styling */
/* -------------------------------------------------------------------------- */

function resolveRateTone(rate: number, hasData: boolean): KPITileTone {
  if (!hasData) return "default";
  const pct = rate * 100;
  if (pct < 50) return "danger";
  if (pct < 80) return "warning";
  return "success";
}

function resolveOpenEscalationsTone(count: number): KPITileTone {
  if (count === 0) return "default";
  if (count <= 2) return "warning";
  return "danger";
}

function resolvePendingWatchesTone(count: number): KPITileTone {
  return count === 0 ? "default" : "warning";
}

/* -------------------------------------------------------------------------- */
/*  Shift / state derivation                                                  */
/* -------------------------------------------------------------------------- */

const NEW_YORK_TZ = "America/New_York";

function deriveCurrentShiftLabel(now: Date = new Date()): string {
  // America/New_York hour. Three operational shifts:
  //   06:00–14:00 → Day shift
  //   14:00–22:00 → Evening shift
  //   22:00–06:00 → Night shift
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: NEW_YORK_TZ,
  });
  const hour = Number.parseInt(fmt.format(now), 10);
  if (Number.isNaN(hour)) return "Current shift";
  if (hour >= 6 && hour < 14) return "Day shift";
  if (hour >= 14 && hour < 22) return "Evening shift";
  return "Night shift";
}

function formatShortDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: NEW_YORK_TZ,
  }).format(now);
}

function deriveStripState(args: {
  loadState: LoadState;
  expected: number;
  active: number;
}): StatusStripState {
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.expected === 0) return "no_rounds";
  if (args.active === 0) return "completed";
  return "in_progress";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

type AdminRoundingPageClientProps = {
  initialSummary: OverviewSummary;
  initialTaskRows: TaskRow[];
  initialError: string | null;
  initialFacilityId: string | null;
  initialEmptyNotice: string | null;
};

export function AdminRoundingPageClient({
  initialSummary,
  initialTaskRows,
  initialError,
  initialFacilityId,
  initialEmptyNotice,
}: AdminRoundingPageClientProps) {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const skipNextLoadRef = useRef(initialError == null);
  const [loadState, setLoadState] = useState<LoadState>(initialError ? "error" : "ready");
  const [summary, setSummary] = useState<OverviewSummary>(initialSummary);
  const [taskRows, setTaskRows] = useState<TaskRow[]>(initialTaskRows);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(initialEmptyNotice);

  const facilityName = useMemo(() => {
    if (!selectedFacilityId) return null;
    return (
      availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null
    );
  }, [availableFacilities, selectedFacilityId]);

  const shiftName = useMemo(() => deriveCurrentShiftLabel(), []);
  const dateLabel = useMemo(() => formatShortDate(), []);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoadState("loading");
    setErrorMessage(null);
    setEmptyNotice(null);

    try {
      const result = await fetchRoundingOverviewFromSupabase(selectedFacilityId);
      setSummary(result.summary);
      setTaskRows(result.taskRows);
      setEmptyNotice(result.emptyNotice);
      setLoadState("ready");
    } catch (err) {
      setErrorMessage(
        formatLiveDataLoadError(
          err,
          "Could not load Smart Rounding metrics. Confirm the facility scope is set and retry.",
        ),
      );
      setSummary(EMPTY_ROUNDING_SUMMARY);
      setTaskRows([]);
      setLoadState("error");
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const stripState = deriveStripState({
    loadState,
    expected: summary.expectedCount,
    active: summary.activeTasks,
  });

  /* ----------------------------------- Render --------------------------- */

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Smart rounding"
        subtitle={
          facilityName
            ? `Live rounding visibility, observation plans, and compliance reporting at ${facilityName}.`
            : "Live rounding visibility, observation plans, and compliance reporting."
        }
        actions={
          <>
            <Link
              href="/admin/rounding/plans/new"
              className={cn(buttonVariants({ variant: "default", size: "default" }))}
            >
              <Plus className="size-4" aria-hidden />
              Create plan
            </Link>
            <Link
              href="/caregiver/rounds"
              className={cn(buttonVariants({ variant: "outline", size: "default" }))}
            >
              <UserPlus className="size-4" aria-hidden />
              Caregiver view
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh Smart Rounding data"
              title="Refresh"
            >
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {!selectedFacilityId ? (
        <AllFacilitiesInterstitial />
      ) : (
        <>
          {facilityName ? (
            <DiscoveryCadenceApplyPanel facilityId={selectedFacilityId} facilityName={facilityName} />
          ) : null}

          {errorMessage ? <LoadErrorNotice message={errorMessage} onRetry={() => void load()} /> : null}
          {!errorMessage && emptyNotice ? <EmptyStateNotice /> : null}

          <StatusStrip
            state={stripState}
            summary={summary}
            shiftName={shiftName}
            dateLabel={dateLabel}
          />

          <section aria-label="Smart Rounding key metrics">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KPITile
                label="Active observation plans"
                value={summary.plans}
                info="Plans currently active for this facility. Inactive or deleted plans excluded."
              />
              <KPITile
                label="On-time rate (today)"
                value={`${Math.round(summary.onTimeRate * 100)}%`}
                tone={resolveRateTone(summary.onTimeRate, summary.expectedCount > 0)}
                info="Share of due tasks completed before the grace window expired in the last 24 hours."
              />
              <KPITile
                label="Open escalations"
                value={summary.openEscalations}
                tone={resolveOpenEscalationsTone(summary.openEscalations)}
                info="Escalations currently open or in review across all rounding evidence."
              />
              <KPITile
                label="Pending watches"
                value={summary.pendingApprovals}
                tone={resolvePendingWatchesTone(summary.pendingApprovals)}
                info="Triggered watches waiting on supervisor approval before activation."
              />
            </div>
          </section>

          <section
            aria-label="Smart Rounding overview content"
            className="grid grid-cols-1 gap-3 lg:grid-cols-3"
          >
            <RecentActivityPanel tasks={taskRows} />
            <QuickLinksPanel summary={summary} />
            <LastShiftSummaryPanel summary={summary} shiftName={shiftName} stripState={stripState} />
          </section>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status strip — dominant "what's happening right now" element              */
/* -------------------------------------------------------------------------- */

function StatusStrip({
  state,
  summary,
  shiftName,
  dateLabel,
}: {
  state: StatusStripState;
  summary: OverviewSummary;
  shiftName: string;
  dateLabel: string;
}) {
  const baseShell =
    "flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between";

  if (state === "loading") {
    return (
      <div className={cn(baseShell, "border-dashed")}>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span aria-hidden className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          Loading current rounding state…
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        className={cn(baseShell, "border-destructive/40 bg-destructive/5")}
        role="status"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm text-foreground">
            Could not load the live rounding state. Try again, or check facility scope.
          </p>
        </div>
      </div>
    );
  }

  if (state === "no_rounds") {
    return (
      <div className={baseShell}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            No rounding cycle started for {shiftName} ·{" "}
            <span className="text-muted-foreground">{dateLabel}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Apply Jessica discovery rounds above to create plans and open the live board.
          </p>
        </div>
      </div>
    );
  }

  if (state === "completed") {
    return (
      <div className={baseShell} role="status">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full bg-success/20 text-success">
              ✓
            </span>
            {shiftName} complete
            <span className="text-muted-foreground">· {dateLabel}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <span className="tabular-nums font-medium text-foreground">
              {summary.completedCount}
            </span>{" "}
            of{" "}
            <span className="tabular-nums font-medium text-foreground">
              {summary.expectedCount}
            </span>{" "}
            checks completed
            {summary.missedCount > 0 ? (
              <>
                {" · "}
                <span className="tabular-nums font-medium text-warning">
                  {summary.missedCount}
                </span>{" "}
                missed (review queue)
              </>
            ) : null}
          </p>
        </div>
        <Link
          href="/admin/rounding/reports"
          className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0")}
        >
          View shift report
        </Link>
      </div>
    );
  }

  // in_progress
  return (
    <div className={baseShell} role="status" aria-live="polite">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <LivePulseDot />
          {shiftName} in progress
          <span className="text-muted-foreground">· {dateLabel}</span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">
            {summary.completedCount}
          </span>{" "}
          of{" "}
          <span className="tabular-nums font-medium text-foreground">
            {summary.expectedCount}
          </span>{" "}
          checks complete
          {summary.missedCount > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums font-medium text-warning">{summary.missedCount}</span>{" "}
              missed
            </>
          ) : null}
          {summary.criticalOverdueCount > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums font-medium text-destructive">
                {summary.criticalOverdueCount}
              </span>{" "}
              critically overdue
            </>
          ) : null}
        </p>
      </div>
      <Link
        href="/admin/rounding/live"
        className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0")}
      >
        <Eye className="size-4" aria-hidden />
        Open live board
      </Link>
    </div>
  );
}

function LivePulseDot() {
  return (
    <span aria-hidden className="relative inline-flex size-2 shrink-0 items-center justify-center">
      <span className="absolute inline-flex size-2 animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Overview panels                                                            */
/* -------------------------------------------------------------------------- */

const TASK_STATUS_COPY: Record<string, { label: string; tone: "muted" | "success" | "warning" | "danger" }> = {
  completed: { label: "Completed", tone: "success" },
  completed_on_time: { label: "Completed on time", tone: "success" },
  completed_late: { label: "Completed late", tone: "warning" },
  missed: { label: "Missed", tone: "danger" },
  critically_overdue: { label: "Critically overdue", tone: "danger" },
  overdue: { label: "Overdue", tone: "warning" },
  pending: { label: "Pending", tone: "muted" },
  in_progress: { label: "In progress", tone: "muted" },
  scheduled: { label: "Scheduled", tone: "muted" },
  excused: { label: "Excused", tone: "muted" },
};

function describeTaskStatus(status: string) {
  return TASK_STATUS_COPY[status] ?? { label: status.replace(/_/g, " "), tone: "muted" as const };
}

function RecentActivityPanel({ tasks }: { tasks: TaskRow[] }) {
  const recent = useMemo(() => {
    // Most recent activity by due_at, prioritising urgent/missed first.
    const ranked = [...tasks].sort((a, b) => {
      const urgentA = a.status === "missed" || a.status === "critically_overdue" ? 0 : 1;
      const urgentB = b.status === "missed" || b.status === "critically_overdue" ? 0 : 1;
      if (urgentA !== urgentB) return urgentA - urgentB;
      return new Date(b.due_at).getTime() - new Date(a.due_at).getTime();
    });
    return ranked.slice(0, 8);
  }, [tasks]);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
        <span className="text-[12px] text-muted-foreground">Last 24 hours</span>
      </header>

      {recent.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No rounding events recorded in the current window.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {recent.map((task) => {
            const status = describeTaskStatus(task.status);
            return (
              <li key={task.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    Rounding check
                  </p>
                  <p className={cn("text-[12px]", toneTextClass(status.tone))}>{status.label}</p>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {formatLiveRoundingTimeOfDay(task.due_at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

type QuickLink = {
  href: string;
  label: string;
  helper: string;
  icon: React.ReactNode;
  badge?: { value: number; tone: "warning" | "danger" };
  priority: number; // lower = higher in list (used to bubble actionable links up)
};

function QuickLinksPanel({ summary }: { summary: OverviewSummary }) {
  // Always show the core workflow links so operators know where they can go.
  // State drives badges + ordering: links with non-default state float to the top.
  const baseLinks: QuickLink[] = [
    {
      href: "/admin/rounding/live",
      label: "Live board",
      helper: "Active rounding checks across all residents",
      icon: <Eye className="size-4" aria-hidden />,
      priority: summary.activeTasks > 0 ? 0 : 10,
    },
    {
      href: "/admin/rounding/escalations",
      label: "Escalation queue",
      helper: "Open escalations awaiting review",
      icon: <AlertTriangle className="size-4" aria-hidden />,
      badge:
        summary.openEscalations > 0
          ? {
              value: summary.openEscalations,
              tone: summary.openEscalations > 2 ? "danger" : "warning",
            }
          : undefined,
      priority: summary.openEscalations > 0 ? 1 : 11,
    },
    {
      href: "/admin/rounding/watches",
      label: "Watch approvals",
      helper: "Pending watches awaiting supervisor sign-off",
      icon: <Shield className="size-4" aria-hidden />,
      badge:
        summary.pendingApprovals > 0
          ? { value: summary.pendingApprovals, tone: "warning" }
          : undefined,
      priority: summary.pendingApprovals > 0 ? 2 : 12,
    },
    {
      href: "/admin/rounding/integrity",
      label: "Integrity review",
      helper: "Documentation-quality flags awaiting resolution",
      icon: <ShieldAlert className="size-4" aria-hidden />,
      badge:
        summary.openIntegrityFlags > 0
          ? { value: summary.openIntegrityFlags, tone: "warning" }
          : undefined,
      priority: summary.openIntegrityFlags > 0 ? 3 : 13,
    },
    {
      href: "/admin/rounding/plans",
      label: "Observation plans",
      helper: "Cadence rules, daypart windows, assignments",
      icon: <ClipboardList className="size-4" aria-hidden />,
      priority: 14,
    },
  ];

  const links = [...baseLinks].sort((a, b) => a.priority - b.priority);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Quick links</h2>
        <span className="text-[12px] text-muted-foreground">Workflow destinations</span>
      </header>

      <ul className="flex flex-col gap-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="group flex items-start gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-muted/40"
            >
              <span className="mt-0.5 text-muted-foreground group-hover:text-foreground">
                {link.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-foreground">{link.label}</span>
                  {link.badge ? (
                    <span
                      className={cn(
                        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                        link.badge.tone === "danger"
                          ? "border border-destructive/40 bg-destructive/10 text-destructive"
                          : "border border-warning/40 bg-warning/10 text-warning",
                      )}
                    >
                      {link.badge.value}
                    </span>
                  ) : null}
                </span>
                <span className="block text-[12px] text-muted-foreground">{link.helper}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

function LastShiftSummaryPanel({
  summary,
  shiftName,
  stripState,
}: {
  summary: OverviewSummary;
  shiftName: string;
  stripState: StatusStripState;
}) {
  const hasData = summary.expectedCount > 0;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Last shift summary</h2>
        <span className="text-[12px] text-muted-foreground">{shiftName}</span>
      </header>

      {!hasData ? (
        <p className="text-[13px] text-muted-foreground">
          No prior shift data in the current 24-hour window. Once rounds begin, summary metrics will
          appear here.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-2">
          <SummaryStat
            label="Checks expected"
            value={summary.expectedCount}
            tone="default"
          />
          <SummaryStat
            label="Completed"
            value={summary.completedCount}
            tone={summary.completedCount === summary.expectedCount ? "success" : "default"}
          />
          <SummaryStat
            label="Missed"
            value={summary.missedCount}
            tone={summary.missedCount === 0 ? "default" : "warning"}
          />
          <SummaryStat
            label="On-time rate"
            value={`${Math.round(summary.onTimeRate * 100)}%`}
            tone={resolveRateTone(summary.onTimeRate, hasData)}
          />
        </dl>
      )}

      {stripState === "completed" ? (
        <p className="text-[12px] text-muted-foreground">
          Shift closed. Sign off in the shift report when ready.
        </p>
      ) : null}
    </article>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: KPITileTone;
}) {
  return (
    <div className="rounded-md border border-border bg-surface/60 px-3 py-2">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums tracking-tight", toneValueClass(tone))}>
        {value}
      </dd>
    </div>
  );
}

function toneValueClass(tone: KPITileTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-destructive";
    case "info":
      return "text-info";
    case "regulatory":
      return "text-regulatory";
    default:
      return "text-foreground";
  }
}

function toneTextClass(tone: "muted" | "success" | "warning" | "danger"): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

/* -------------------------------------------------------------------------- */
/*  Interstitials + notices                                                   */
/* -------------------------------------------------------------------------- */

function AllFacilitiesInterstitial() {
  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-card p-6"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Smart Rounding operates per facility
            </p>
            <p className="text-[13px] text-muted-foreground">
              Live rounding cycles, observation plans, and escalations are facility-scoped. Select a
              facility from the top bar to continue.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyStateNotice() {
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-muted/20 p-3"
      role="status"
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        No rounding tasks in the last 24 hours. Apply Jessica discovery rounds above to start a live
        cycle, or{" "}
        <Link
          href="/admin/rounding/plans/new"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          create a custom observation plan
        </Link>
        .
      </p>
    </div>
  );
}

function LoadErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-8 shrink-0 text-[12px]">
        Retry
      </Button>
    </div>
  );
}
