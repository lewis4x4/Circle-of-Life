"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Home, Loader2 } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "target_move_in_date"
  | "financial_clearance_at"
  | "physician_orders_received_at"
  | "bed_id"
> & {
  residents: { first_name: string; last_name: string } | null;
};

function admissionReady(row: CaseRow): boolean {
  return Boolean(
    row.financial_clearance_at &&
      row.physician_orders_received_at &&
      row.bed_id &&
      row.target_move_in_date &&
      row.status !== "cancelled",
  );
}

function formatRelative(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminMoveInReadyPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from("admission_cases")
        .select("id, status, updated_at, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .order("target_move_in_date", { ascending: true });

      if (queryError) throw queryError;
      setRows(((data ?? []) as CaseRow[]).filter(admissionReady));
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load move-in ready cases.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Admissions hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Move-In Ready</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Admission cases with core readiness items complete and ready to progress into operations.
            </p>
          </div>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            {rows.length} ready
          </Badge>
        </div>
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No move-in ready admissions"
          description="No cases currently meet the core move-in readiness criteria in this scope."
        />
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <Card key={row.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Home className="h-4 w-4 text-emerald-500" />
                      {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unlinked case"}
                    </CardTitle>
                    <CardDescription className="mt-1">Admission case {row.id}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Ready
                    </Badge>
                    {row.target_move_in_date ? (
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                        <CalendarDays className="mr-1 h-3 w-3" />
                        {row.target_move_in_date}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Last updated</div>
                    <div className="mt-1 text-slate-900 dark:text-slate-100">{formatRelative(row.updated_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Current status</div>
                    <div className="mt-1 capitalize text-slate-900 dark:text-slate-100">{row.status.replace(/_/g, " ")}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/admissions/${row.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Open case
                  </Link>
                  {row.status !== "move_in" ? (
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
                      Advance the case to move-in from the detail page.
                    </span>
                  ) : (
                    <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                      Move-in status already set. Continue downstream onboarding.
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
