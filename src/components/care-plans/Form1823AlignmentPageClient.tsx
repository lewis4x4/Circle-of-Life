"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileCheck2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchForm1823AlignmentRoster, type Form1823AlignmentRoster, type Form1823AlignmentRosterRow } from "@/lib/care-plans/form-1823-alignment-roster";
import { cn } from "@/lib/utils";

type Props = {
  initialRoster: Form1823AlignmentRoster | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

function RowBadge({ row }: { row: Form1823AlignmentRosterRow }) {
  if (row.form1823 === null) {
    return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">No Form 1823 on file</Badge>;
  }
  if (row.summary?.noPlan) {
    return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">No active care plan</Badge>;
  }
  if (row.gaps.length > 0) {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{row.gaps.length} need{row.gaps.length === 1 ? "" : "s"} not answered</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Plan answers the 1823</Badge>;
}

/**
 * The standard-ALF survey question, facility-wide: for every resident, is
 * there a current 1823, and does the active plan answer what it says?
 */
export function Form1823AlignmentPageClient({ initialRoster, initialError, initialFacilityId }: Props) {
  const { selectedFacilityId } = useFacilityStore();
  const [roster, setRoster] = useState<Form1823AlignmentRoster | null>(initialRoster);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
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
      setRoster(await fetchForm1823AlignmentRoster(selectedFacilityId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Form 1823 alignment.");
      setRoster(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-32 w-full rounded-lg bg-slate-200 dark:bg-white/5" />
        <Skeleton className="h-[480px] w-full rounded-lg bg-slate-200 dark:bg-white/5" />
      </div>
    );
  }

  if (error || !roster) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="max-w-lg rounded-lg border border-rose-200 bg-rose-50/60 p-8 text-center shadow-sm dark:border-rose-900/40 dark:bg-rose-950/20">
          <ShieldAlert className="mx-auto mb-4 h-8 w-8 text-rose-600 dark:text-rose-400" />
          <h2 className="text-xl font-semibold text-rose-800 dark:text-rose-300">Form 1823 alignment unavailable</h2>
          <p className="mt-2 text-sm text-rose-700/80 dark:text-rose-400/80">{error ?? "Unable to load Form 1823 alignment."}</p>
          <button type="button" onClick={() => void load()} className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { rows, counts } = roster;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between rounded-lg border border-slate-200/50 bg-card p-8 shadow-sm dark:border-white/5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-100/50 px-3 py-1.5 text-[10px] font-bold text-primary-800 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-300">
            <FileCheck2 className="h-3.5 w-3.5" />
            Care Plans
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-2xl">Form 1823 alignment</h1>
          <p className="text-slate-600 dark:text-zinc-400">
            For every current resident: is there a current Form 1823 on file, and does the active care plan answer what it says?
            This is what a standard-ALF survey checks; the plan itself is not the deliverable.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold tracking-wide text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {counts.noForm1823} without a 1823
          </div>
          <div className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold tracking-wide text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {counts.noPlan} without an active plan
          </div>
          <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            {counts.withGaps} with unanswered needs
          </div>
          <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            {counts.expiredForm1823} with a 1823 past 3 years
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-8 py-20 text-center dark:border-white/10 dark:bg-white/[0.02]">
          <ClipboardList className="mx-auto mb-4 h-14 w-14 text-slate-300 dark:text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">No current residents in scope</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            Residents with status active, hospital hold, or leave of absence appear here once they exist in the selected facility.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200/60 bg-card p-6 shadow-sm dark:border-white/5 dark:bg-white/[0.02]">
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.residentId}
                className="flex flex-col gap-4 rounded-lg border border-slate-200/70 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between dark:border-white/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">{row.residentName}</span>
                    <RowBadge row={row} />
                    {row.form1823?.expired ? (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">1823 past 3 years</Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-zinc-400">
                    <span>{row.form1823 ? row.form1823.ageLabel : "No current, received Form 1823"}</span>
                    <span>{row.planId ? `Active plan v${row.planVersion ?? "?"}` : "No active plan"}</span>
                    {row.summary && !row.summary.noPlan ? (
                      <span>
                        {row.summary.addressed} addressed · {row.summary.weaker} weaker · {row.summary.notAddressed} not addressed
                      </span>
                    ) : null}
                  </div>
                  {row.gaps.length > 0 ? (
                    <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">Unanswered: {row.gaps.join(", ")}</p>
                  ) : null}
                </div>
                <Link
                  href={row.form1823 ? `/admin/residents/${row.residentId}/care-plan` : `/admin/residents/${row.residentId}`}
                  className={cn(
                    buttonVariants({ size: "default" }),
                    "h-11 rounded-full px-6 font-bold text-[10px] bg-primary-600 text-white shadow-sm hover:bg-primary-700",
                  )}
                >
                  {row.form1823 ? "Open care plan" : "Open resident"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
