"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileSignature, ShieldAlert } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchCarePlanReviewsDue,
  type CarePlanReviewDueRow,
} from "@/lib/care-plans/reviews-due";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function StatusBadge({ daysOverdue }: { daysOverdue: number }) {
  if (daysOverdue > 7) {
    return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Escalated</Badge>;
  }
  if (daysOverdue > 0) {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Overdue</Badge>;
  }
  return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">Due now</Badge>;
}

export default function CarePlanReviewsDuePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CarePlanReviewDueRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchCarePlanReviewsDue(selectedFacilityId);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load care plan reviews.");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdueCount = useMemo(() => rows.filter((row) => row.daysOverdue > 0).length, [rows]);
  const dueTodayCount = useMemo(() => rows.filter((row) => row.daysOverdue === 0).length, [rows]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-32 w-full rounded-[2.5rem] bg-slate-200 dark:bg-white/5" />
        <Skeleton className="h-[480px] w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="max-w-lg rounded-[2rem] border border-rose-200 bg-rose-50/60 p-8 text-center shadow-sm dark:border-rose-900/40 dark:bg-rose-950/20">
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
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between rounded-[2.5rem] border border-slate-200/50 bg-white/40 p-8 shadow-sm backdrop-blur-3xl dark:border-white/5 dark:bg-black/20">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-100/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
            <FileSignature className="h-3.5 w-3.5" />
            Care Plans
          </div>
          <h1 className="text-4xl font-display font-light tracking-tight text-slate-900 dark:text-white md:text-5xl">
            Reviews Due
          </h1>
          <p className="text-slate-600 dark:text-zinc-400">
            Active care plans due today or overdue for review across the selected facility scope.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold tracking-wide text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {overdueCount} overdue
          </div>
          <div className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold tracking-wide text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-300">
            {dueTodayCount} due today
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/80 px-8 py-20 text-center dark:border-white/10 dark:bg-white/[0.02]">
          <ClipboardList className="mx-auto mb-4 h-14 w-14 text-slate-300 dark:text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">No reviews due</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            There are no active care plans due for review in the current facility scope.
          </p>
        </div>
      ) : (
        <div className="rounded-[2rem] border border-slate-200/60 bg-white/60 p-6 shadow-sm backdrop-blur-3xl dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Review queue</h2>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Open the resident care plan to review, sign, or revise the active version.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-4 rounded-[1.5rem] border border-slate-200/70 bg-white p-5 shadow-sm transition-colors hover:border-indigo-200 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-indigo-500/30 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">{row.residentName}</span>
                    <StatusBadge daysOverdue={row.daysOverdue} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-zinc-400">
                    <span>Version {row.version}</span>
                    <span>Effective {row.effectiveDate}</span>
                    <span>Review due {row.reviewDueDate}</span>
                    <span>{row.daysOverdue === 0 ? "Due today" : `${row.daysOverdue} days overdue`}</span>
                  </div>
                </div>

                <Link
                  href={`/admin/residents/${row.residentId}/care-plan`}
                  className={cn(
                    buttonVariants({ size: "default" }),
                    "h-11 rounded-full px-6 font-bold uppercase tracking-widest text-[10px] bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
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
