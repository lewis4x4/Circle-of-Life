"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, CalendarClock, ChevronRight } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DEFAULT_FILTERS = { search: "", status: "all" };

type Row = {
  id: string;
  residentId: string;
  residentName: string;
  version: number;
  status: string;
  effectiveDate: string;
  reviewDueDate: string;
  daysOverdue: number;
};

type SupabasePlan = {
  id: string;
  resident_id: string;
  facility_id: string;
  version: number | null;
  status: string;
  effective_date: string;
  review_due_date: string;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return d.toISOString().slice(0, 10);
  return `${y}-${m}-${day}`;
}

function parseISODateOnly(value: string): number {
  const [yy, mm, dd] = value.split("-").map(Number);
  if (!yy || !mm || !dd) return NaN;
  return new Date(Date.UTC(yy, mm - 1, dd)).getTime();
}

export default function AdminCarePlanReviewsDuePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [statusFilter, setStatusFilter] = useState(DEFAULT_FILTERS.status);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchReviewsDue(selectedFacilityId);
      setRows(live);
    } catch {
      setRows(mockRows);
      setError("Live care plan data is unavailable. Showing demo review queue.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(rows.map((r) => r.status))).sort((a, b) => a.localeCompare(b));
    return [{ value: "all", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: formatSnake(s) }))];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch = q.length === 0 || r.residentName.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No care plans due for review in this scope",
          description:
            "Live data returned no active plans with a review due on or before today for the selected facility or organization filter.",
        },
        whenFiltersExcludeAll: {
          title: "No plans match the current filters",
          description:
            "Try clearing search or broadening status. Rows are scoped by your current facility selection.",
        },
      }),
    [rows.length],
  );

  const urgent = rows.filter((r) => r.daysOverdue > 0).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Care plan reviews due
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Active plans with review due on or before today (America/New_York).
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <CalendarClock className="mr-1 h-3.5 w-3.5" />
          {urgent} need attention
        </Badge>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search resident..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: statusOptions,
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatusFilter(DEFAULT_FILTERS.status);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filtered.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && filtered.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="font-display text-lg">Review queue</CardTitle>
            <CardDescription>Oldest review dates first</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/70 dark:bg-slate-900/60">
                <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
                  <TableHead className="pl-4 font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium">Version</TableHead>
                  <TableHead className="font-medium">Effective</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Review due
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="font-medium">Days</TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="border-slate-100 dark:border-slate-800">
                    <TableCell className="pl-4 font-medium text-slate-900 dark:text-slate-100">{r.residentName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {formatSnake(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>v{r.version}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{r.effectiveDate}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{r.reviewDueDate}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.daysOverdue > 14
                            ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200"
                            : r.daysOverdue > 0
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }
                      >
                        {r.daysOverdue > 0 ? `${r.daysOverdue}d late` : "Due today"}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/residents/${r.residentId}/care-plan`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open care plan for ${r.residentName}`}
                      >
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function fetchReviewsDue(selectedFacilityId: string | null): Promise<Row[]> {
  const today = easternDateString();
  const supabase = createClient();
  let q = supabase
    .from("care_plans" as never)
    .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("review_due_date", today)
    .order("review_due_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryListResult<SupabasePlan>;
  if (res.error) throw res.error;
  const plans = res.data ?? [];
  if (plans.length === 0) return [];

  const residentIds = [...new Set(plans.map((p) => p.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return plans.map((p) => {
    const rm = resById.get(p.resident_id);
    const name = rm
      ? `${rm.first_name ?? ""} ${rm.last_name ?? ""}`.trim() || "Unknown"
      : "Unknown";
    const dueMs = parseISODateOnly(p.review_due_date);
    const daysOverdue = Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    return {
      id: p.id,
      residentId: p.resident_id,
      residentName: name,
      version: p.version ?? 1,
      status: p.status,
      effectiveDate: formatDisplayDate(p.effective_date),
      reviewDueDate: formatDisplayDate(p.review_due_date),
      daysOverdue,
    };
  });
}

function formatDisplayDate(iso: string): string {
  const t = parseISODateOnly(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

function formatSnake(s: string): string {
  return s.replace(/_/g, " ");
}

const mockRows: Row[] = [
  {
    id: "mock-p1",
    residentId: "00000000-0000-4000-8000-000000000002",
    residentName: "Demo Resident",
    version: 2,
    status: "active",
    effectiveDate: "Feb 1, 2026",
    reviewDueDate: "Mar 20, 2026",
    daysOverdue: 5,
  },
];
