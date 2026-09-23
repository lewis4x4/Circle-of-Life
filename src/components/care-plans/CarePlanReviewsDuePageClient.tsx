"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileSignature, ShieldAlert } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchActiveCarePlanCount,
  fetchCarePlanReviewsDue,
  type CarePlanReviewDueRow,
} from "@/lib/care-plans/reviews-due";
import { clinicalQueueCount, describeClinicalQueue, formatQueueChip } from "@/lib/clinical/clinical-queue-state";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function isDateDue(row: CarePlanReviewDueRow): boolean {
  return row.reasons.some((reason) => reason.kind === "review_due");
}

function StatusBadge({ row }: { row: CarePlanReviewDueRow }) {
  if (!isDateDue(row)) {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Change flagged</Badge>;
  }
  if (row.daysOverdue > 7) {
    return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Escalated</Badge>;
  }
  if (row.daysOverdue > 0) {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Overdue</Badge>;
  }
  return <Badge className="bg-primary/10 text-primary">Due now</Badge>;
}

type CarePlanReviewsDuePageClientProps = {
  initialRows: CarePlanReviewDueRow[];
  initialError: string | null;
  initialActivePlanCount: number | null;
  initialFacilityId: string | null;
};

export function CarePlanReviewsDuePageClient({
  initialRows,
  initialError,
  initialActivePlanCount,
  initialFacilityId,
}: CarePlanReviewsDuePageClientProps) {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CarePlanReviewDueRow[]>(initialRows);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [activePlanCount, setActivePlanCount] = useState<number | null>(initialActivePlanCount);
  const [dismissing, setDismissing] = useState<{ alertId: string; notes: string } | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);

  const skipNextLoadRef = useRef(initialError == null);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);
    try {
      const [data, planCount] = await Promise.all([
        fetchCarePlanReviewsDue(selectedFacilityId),
        fetchActiveCarePlanCount(selectedFacilityId),
      ]);
      setRows(data);
      setActivePlanCount(planCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load care plan reviews.");
      setRows([]);
      setActivePlanCount(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchAlert = useCallback(
    async (alertId: string, action: "acknowledge" | "dismiss", notes?: string) => {
      setBusyAlertId(alertId);
      setAlertError(null);
      try {
        const res = await fetch(`/api/care-plans/review-alerts/${alertId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, notes }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Review alert could not be updated");
        }
        setDismissing(null);
        setRows(await fetchCarePlanReviewsDue(selectedFacilityId));
      } catch (err) {
        setAlertError(err instanceof Error ? err.message : "Review alert could not be updated");
      } finally {
        setBusyAlertId(null);
      }
    },
    [selectedFacilityId],
  );

  const overdueCount = useMemo(() => rows.filter((row) => isDateDue(row) && row.daysOverdue > 0).length, [rows]);
  const dueTodayCount = useMemo(() => rows.filter((row) => isDateDue(row) && row.daysOverdue === 0).length, [rows]);
  const flaggedCount = useMemo(() => rows.filter((row) => row.reasons.some((r) => r.kind === "alert")).length, [rows]);
  const queueState = describeClinicalQueue({
    scopeReady: true,
    error,
    scopeSize: activePlanCount,
    itemCount: rows.length,
  });
  const chip = (count: number, noun: string) =>
    formatQueueChip(clinicalQueueCount(queueState, count, "No active care plans"), noun);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-32 w-full rounded-lg bg-slate-200 dark:bg-white/5" />
        <Skeleton className="h-[480px] w-full rounded-lg bg-slate-200 dark:bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="max-w-lg rounded-lg border border-rose-200 bg-rose-50/60 p-8 text-center shadow-sm dark:border-rose-900/40 dark:bg-rose-950/20">
          <ShieldAlert className="mx-auto mb-4 h-8 w-8 text-rose-600 dark:text-rose-400" />
          <h2 className="text-xl font-semibold text-rose-800 dark:text-rose-300">Care plan queue unavailable</h2>
          <p className="mt-2 text-sm text-rose-700/80 dark:text-rose-400/80">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className={cn(buttonVariants({ variant: "outline" }), "mt-6")}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between rounded-lg border border-slate-200/50 bg-card p-8 shadow-sm dark:border-white/5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] font-bold text-primary">
            <FileSignature className="h-3.5 w-3.5" />
            Care Plans
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-2xl">
            Reviews Due
          </h1>
          <p className="text-slate-600 dark:text-zinc-400">
            Active care plans due for review, or flagged by a significant change — a fall, a hospital return, a
            condition or acuity change, a renewed Form 1823 — across the selected facility scope.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold tracking-wide text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {chip(overdueCount, "overdue")}
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-bold tracking-wide text-primary">
            {chip(dueTodayCount, "due today")}
          </div>
          <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            {chip(flaggedCount, "flagged by a change")}
          </div>
        </div>
      </div>

      {queueState === "nothing_on_file" ? (
        <div
          data-queue-state={queueState}
          className="rounded-lg border border-dashed border-border bg-muted/40 px-8 py-20 text-center"
        >
          <ClipboardList className="mx-auto mb-4 h-14 w-14 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No active care plans</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            No resident in this scope has an active care plan, so no review can be due. Plans start from the
            Form 1823 alignment queue.
          </p>
          <Link
            href="/admin/care-plans/form-1823-alignment"
            className={cn(buttonVariants({ variant: "outline" }), "mt-6")}
          >
            Open Form 1823 alignment
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-8 py-20 text-center dark:border-white/10 dark:bg-white/[0.02]">
          <ClipboardList className="mx-auto mb-4 h-14 w-14 text-slate-300 dark:text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">No reviews due</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            There are no active care plans due for review or flagged by a change in the current facility scope.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200/60 bg-card p-6 shadow-sm dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Review queue</h2>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Open the resident care plan to review, sign, or revise the active version. A new active version
                resolves the older plan&apos;s flags; acknowledge one to show it has been seen, or dismiss it with a reason.
              </p>
              {alertError ? <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{alertError}</p> : null}
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-4 rounded-lg border border-slate-200/70 bg-white p-5 shadow-sm transition-colors hover:border-primary/20 dark:border-white/10 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">{row.residentName}</span>
                    <StatusBadge row={row} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-zinc-400">
                    <span>Version {row.version}</span>
                    <span>Effective {row.effectiveDate}</span>
                    <span>Review due {row.reviewDueDate}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {row.reasons.map((reason) => (
                      <li key={reason.alertId ?? `${row.id}:due`} className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            reason.kind === "alert"
                              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"
                              : "border-slate-200 bg-slate-50 text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200",
                          )}
                        >
                          {reason.label}
                          {reason.alertStatus === "acknowledged" ? " · acknowledged" : ""}
                        </span>
                        {reason.kind === "alert" && reason.alertId ? (
                          dismissing?.alertId === reason.alertId ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <input
                                value={dismissing.notes}
                                onChange={(e) => setDismissing({ alertId: reason.alertId!, notes: e.target.value })}
                                placeholder="Reason for dismissing"
                                aria-label="Reason for dismissing"
                                className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-white/20 dark:bg-transparent"
                              />
                              <button
                                type="button"
                                disabled={busyAlertId === reason.alertId || dismissing.notes.trim().length < 3}
                                onClick={() => void patchAlert(reason.alertId!, "dismiss", dismissing.notes)}
                                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                              >
                                Confirm dismiss
                              </button>
                              <button
                                type="button"
                                onClick={() => setDismissing(null)}
                                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 text-xs")}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              {reason.alertStatus === "open" ? (
                                <button
                                  type="button"
                                  disabled={busyAlertId === reason.alertId}
                                  onClick={() => void patchAlert(reason.alertId!, "acknowledge")}
                                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                                >
                                  Acknowledge
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={busyAlertId === reason.alertId}
                                onClick={() => setDismissing({ alertId: reason.alertId!, notes: "" })}
                                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 text-xs")}
                              >
                                Dismiss
                              </button>
                            </span>
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <Link
                  href={`/admin/residents/${row.residentId}/care-plan`}
                  className={cn(
                    buttonVariants({ size: "default" }),
                    "h-11 rounded-full px-6 font-bold uppercase tracking-wider text-[10px] shadow-sm"
                  )}
                >
                  Review & sign
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
