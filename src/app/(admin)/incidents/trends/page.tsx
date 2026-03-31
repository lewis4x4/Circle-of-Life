"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, TrendingUp } from "lucide-react";

import { AdminEmptyState, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const DAYS = 90;

type Row = {
  id: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function startIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function humanCategory(raw: string): string {
  return raw.replace(/_/g, " ");
}

export default function AdminIncidentTrendsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const since = startIso(DAYS);
      let q = supabase
        .from("incidents" as never)
        .select("id, category, severity, status, occurred_at")
        .is("deleted_at", null)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(800);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const res = (await q) as unknown as QueryListResult<Row>;
      if (res.error) throw res.error;
      setRows(res.data ?? []);
    } catch {
      setError("Incident analytics could not be loaded.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const byCategory = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    let open = 0;
    for (const r of rows) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
      bySeverity.set(r.severity, (bySeverity.get(r.severity) ?? 0) + 1);
      if (r.status !== "closed" && r.status !== "resolved") open += 1;
    }
    const catSorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const sevOrder = ["level_4", "level_3", "level_2", "level_1"];
    const sevSorted = sevOrder
      .filter((s) => bySeverity.has(s))
      .map((s) => [s, bySeverity.get(s) ?? 0] as const);
    const maxCat = catSorted[0]?.[1] ?? 1;
    const maxSev = Math.max(1, ...sevSorted.map(([, n]) => n));
    return { byCategory: catSorted, bySeverity: sevSorted, open, total: rows.length, maxCat, maxSev };
  }, [rows]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href="/admin/incidents"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 inline-flex gap-1 px-0")}
          >
            ← Incident queue
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
              <BarChart3 className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Incident trends
              </h1>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Last {DAYS} days, scoped to your facility selection.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-slate-200 dark:border-slate-700">
            <TrendingUp className="mr-1 h-3.5 w-3.5" />
            {stats.total} incidents
          </Badge>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            {stats.open} open / investigating
          </Badge>
        </div>
      </header>

      {loading ? <AdminTableLoadingState /> : null}
      {!loading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <AdminEmptyState
          title="No incidents in this window"
          description="When reportable events land in Supabase for the selected facility, category and severity distributions appear here."
        />
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">By category</CardTitle>
              <CardDescription>Raw incident_category enum counts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.byCategory.slice(0, 12).map(([cat, count]) => (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="truncate pr-2 text-slate-700 dark:text-slate-300">{humanCategory(cat)}</span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-slate-100">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-600"
                      style={{ width: `${Math.round((count / stats.maxCat) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">By severity</CardTitle>
              <CardDescription>Distribution across L1–L4</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.bySeverity.map(([sev, count]) => (
                <div key={sev} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="uppercase text-slate-700 dark:text-slate-300">{sev.replace(/_/g, " ")}</span>
                    <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        sev === "level_4"
                          ? "bg-red-500"
                          : sev === "level_3"
                            ? "bg-orange-500"
                            : sev === "level_2"
                              ? "bg-amber-500"
                              : "bg-slate-400",
                      )}
                      style={{ width: `${Math.round((count / stats.maxSev) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
