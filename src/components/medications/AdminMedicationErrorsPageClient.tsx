"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchMedicationErrors,
  type MedicationErrorRow,
} from "@/lib/medications/load-medication-errors";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type ReviewFilter = "all" | "unreviewed" | "reviewed";

type AdminMedicationErrorsPageClientProps = {
  initialRows: MedicationErrorRow[];
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminMedicationErrorsPageClient({
  initialRows,
  initialError,
  initialFacilityId,
}: AdminMedicationErrorsPageClientProps) {
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [rows, setRows] = useState<MedicationErrorRow[]>(initialRows);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");

  const skipNextLoadRef = useRef(initialError == null);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoading(true);
    setError(null);
    try {
      const list = await fetchMedicationErrors(selectedFacilityId);
      setRows(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedFilter = searchParams.get("review");
    if (requestedFilter === "reviewed" || requestedFilter === "unreviewed") {
      setReviewFilter(requestedFilter);
      return;
    }
    setReviewFilter("all");
  }, [searchParams]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (reviewFilter === "unreviewed") return !row.reviewed_at;
      if (reviewFilter === "reviewed") return Boolean(row.reviewed_at);
      return true;
    });
  }, [reviewFilter, rows]);

  const visibleTotals = useMemo(() => {
    const bySeverity: Record<string, number> = {};
    for (const row of visibleRows) {
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    }
    return { n: visibleRows.length, bySeverity };
  }, [visibleRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/20 text-[10px] font-bold uppercase tracking-wider text-destructive mb-2 block w-fit">
              Error Reporting
          </div>
          <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-foreground">
            Medication Errors
          </h1>
          <p className="text-sm font-medium tracking-wide text-muted-foreground mt-2">
            Structured reports (aggregate view — no staff names on charts).
          </p>
        </div>
        <Link href="/admin/medications/errors/new" className={cn(buttonVariants(), "h-12 px-8 rounded-[var(--radius)] font-bold uppercase tracking-wider text-xs tap-responsive bg-destructive hover:bg-destructive/90 text-destructive-foreground")} >
          Report Error
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">In view</p>
          <p className="text-2xl font-semibold tabular-nums">{visibleTotals.n}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4 sm:col-span-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">By severity in view</p>
          <p className="text-sm text-muted-foreground">
            {Object.entries(visibleTotals.bySeverity).length === 0
              ? "—"
              : Object.entries(visibleTotals.bySeverity)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          { value: "all", label: `All (${rows.length})` },
          { value: "unreviewed", label: `Unreviewed (${rows.filter((row) => !row.reviewed_at).length})` },
          { value: "reviewed", label: `Reviewed (${rows.filter((row) => !!row.reviewed_at).length})` },
        ] as Array<{ value: ReviewFilter; label: string }>).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setReviewFilter(option.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            reviewFilter === option.value
              ? "bg-destructive text-destructive-foreground"
              : "bg-card text-muted-foreground hover:bg-muted/40",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {reviewFilter !== "all" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
            Review filter: {reviewFilter}
          </Badge>
          <Link href="/admin/medications/errors" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
            Clear review filter
          </Link>
        </div>
      ) : null}

      {error ? <p className="text-sm text-warning">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : visibleRows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-border bg-muted/40 p-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-foreground tracking-tight">No Errors Found</p>
          <p className="text-sm font-medium text-muted-foreground mt-1">
            {rows.length === 0 ? "There are no medication errors logged for this facility." : "No medication errors match this review filter."}
          </p>
        </div>
      ) : (
        <div className="border-border rounded-[var(--radius)] bg-card p-6 md:p-8 shadow-sm relative overflow-hidden">
          
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-border relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Type</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Severity</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Occurred</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:text-right">Reviewed</div>
          </div>

          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {visibleRows.map((r) => (
                <MotionItem key={r.id}>
                  <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center min-h-[36px] px-[13px] py-3 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] tap-responsive w-full outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                    
                    <div className="flex flex-col min-w-0 pr-4">
                      <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Type</span>
                      <span className="font-semibold text-lg text-foreground capitalize tracking-tight">
                        {r.error_type.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Severity</span>
                      <Badge variant="outline" className={cn("capitalize px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider shadow-sm w-fit",
                        r.severity === "critical" ? "bg-destructive/10 text-destructive border-destructive/20" :
                        r.severity === "high" ? "bg-warning/10 text-warning border-warning/20" :
                        "bg-muted text-muted-foreground border-border"
                      )}>
                        {r.severity.replace(/_/g, " ")}
                      </Badge>
                    </div>

                    <div className="flex flex-col">
                      <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Occurred</span>
                      <span className="text-[11px] font-mono tracking-wider text-muted-foreground whitespace-nowrap tabular-nums">
                        {new Date(r.occurred_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex flex-col lg:items-end lg:pr-2">
                      <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Reviewed</span>
                      <span className="text-[11px] font-mono tracking-wider text-muted-foreground whitespace-nowrap tabular-nums">
                        {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : "—"}
                      </span>
                    </div>

                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        </div>
      )}
    </div>
  );
}
