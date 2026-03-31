"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ScheduleRow = {
  id: string;
  weekStartDate: string;
  status: string;
  publishedAt: string | null;
  notes: string | null;
};

type SupabaseScheduleRow = {
  id: string;
  week_start_date: string;
  status: string;
  published_at: string | null;
  notes: string | null;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

const DEFAULT_FILTERS = { search: "", status: "all" };

export default function AdminSchedulesPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchSchedulesFromSupabase(selectedFacilityId);
      setRows(live);
    } catch {
      setRows(mockSchedules);
      setError("Live schedules are unavailable. Showing demo weeks.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.notes?.toLowerCase().includes(q) ||
        formatWeekLabel(row.weekStartDate).toLowerCase().includes(q);
      const matchesStatus = status === "all" || row.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, status]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No schedules in this scope",
          description:
            "Live data returned no schedule weeks for the selected facility or organization filter. Create a week in Supabase or adjust scope.",
        },
        whenFiltersExcludeAll: {
          title: "No schedules match the current filters",
          description:
            "Schedules are created per facility and week. Pick a facility or clear filters to see more rows.",
        },
      }),
    [rows.length],
  );

  const draftCount = rows.filter((r) => r.status === "draft").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Schedules
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Weekly schedule containers; shift assignments roll up under each published week.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-slate-200 bg-white px-3 py-1 dark:border-slate-800 dark:bg-slate-900"
        >
          <CalendarDays className="mr-1 h-3.5 w-3.5" />
          {draftCount} draft week{draftCount === 1 ? "" : "s"}
        </Badge>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search week label or notes..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatus(DEFAULT_FILTERS.status);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Schedule weeks</CardTitle>
            <CardDescription>Monday-start weeks; publish when ready for floor use.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Week</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Published</TableHead>
                  <TableHead className="hidden lg:table-cell">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                      {formatWeekLabel(row.weekStartDate)}
                    </TableCell>
                    <TableCell>
                      <ScheduleStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                      {row.publishedAt ? formatDateTime(row.publishedAt) : "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-md truncate text-slate-500 dark:text-slate-400 lg:table-cell">
                      {row.notes?.trim() || "—"}
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

async function fetchSchedulesFromSupabase(selectedFacilityId: string | null): Promise<ScheduleRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("schedules" as never)
    .select("id, week_start_date, status, published_at, notes, deleted_at")
    .is("deleted_at", null)
    .order("week_start_date", { ascending: false })
    .limit(120);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseScheduleRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  return list.map((r) => ({
    id: r.id,
    weekStartDate: r.week_start_date,
    status: r.status,
    publishedAt: r.published_at,
    notes: r.notes,
  }));
}

function formatWeekLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return `Week of ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(parsed)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    published: {
      label: "Published",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    archived: { label: "Archived", className: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400" },
  };
  const m = map[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return <Badge className={m.className}>{m.label}</Badge>;
}

const mockSchedules: ScheduleRow[] = [
  {
    id: "sched-demo-1",
    weekStartDate: "2026-03-03",
    status: "published",
    publishedAt: "2026-03-01T14:00:00.000Z",
    notes: "Spring census staffing pattern",
  },
  {
    id: "sched-demo-2",
    weekStartDate: "2026-03-10",
    status: "draft",
    publishedAt: null,
    notes: null,
  },
];
