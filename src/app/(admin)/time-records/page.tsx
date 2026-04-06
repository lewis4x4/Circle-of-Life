"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TimeRow = {
  id: string;
  staffId: string;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  approved: boolean;
  actualHours: number | null;
};

type SupabaseTimeRow = {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
  approved: boolean;
  actual_hours: number | string | null;
  deleted_at: string | null;
};

type SupabaseStaffMini = {
  id: string;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

const DEFAULT_FILTERS = { search: "", approved: "all" };

export default function AdminTimeRecordsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<TimeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [approved, setApproved] = useState(DEFAULT_FILTERS.approved);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchTimeRecordsFromSupabase(selectedFacilityId);
      setRows(live);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
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
      const matchesSearch = q.length === 0 || row.staffName.toLowerCase().includes(q);
      const matchesApproved =
        approved === "all" ||
        (approved === "yes" && row.approved) ||
        (approved === "no" && !row.approved);
      return matchesSearch && matchesApproved;
    });
  }, [rows, search, approved]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No time records in this scope",
          description:
            "Live data returned no punches for the selected facility or organization filter. Use Add time record for manual corrections or wait for staff clock events.",
        },
        whenFiltersExcludeAll: {
          title: "No time records match the current filters",
          description:
            "Punches appear as caregivers clock in and out. Scope follows your facility selector.",
        },
      }),
    [rows.length],
  );

  const pendingApproval = rows.filter((r) => !r.approved && r.clockOut).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Time records
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Recent clock activity with approval state for payroll readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/time-records/new" className={buttonVariants({ size: "sm" })}>
            Add time record
          </Link>
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <Clock className="mr-1 h-3.5 w-3.5" />
            {pendingApproval} pending approval
          </Badge>
        </div>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search staff name..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "approved",
            value: approved,
            onChange: setApproved,
            options: [
              { value: "all", label: "All approval states" },
              { value: "yes", label: "Approved" },
              { value: "no", label: "Not approved" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setApproved(DEFAULT_FILTERS.approved);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Recent punches</CardTitle>
            <CardDescription>Newest first; open staff profile for employment context.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead className="hidden sm:table-cell">Clock in</TableHead>
                  <TableHead className="hidden sm:table-cell">Clock out</TableHead>
                  <TableHead className="hidden md:table-cell">Hours</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead className="pr-4 text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{row.staffName}</TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                      {formatDateTime(row.clockIn)}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                      {row.clockOut ? formatDateTime(row.clockOut) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                      {row.actualHours != null ? Number(row.actualHours).toFixed(2) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.approved ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Yes
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          No
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/staff/${row.staffId}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${row.staffName}`}
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

async function fetchTimeRecordsFromSupabase(selectedFacilityId: string | null): Promise<TimeRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("time_records" as never)
    .select("id, staff_id, clock_in, clock_out, approved, actual_hours, deleted_at")
    .is("deleted_at", null)
    .order("clock_in", { ascending: false })
    .limit(150);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseTimeRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  if (list.length === 0) return [];

  const staffIds = [...new Set(list.map((t) => t.staff_id))];
  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name, deleted_at")
    .in("id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
  if (staffRes.error) throw staffRes.error;

  const nameById = new Map<string, string>();
  for (const s of staffRes.data ?? []) {
    const first = s.first_name?.trim() ?? "";
    const last = s.last_name?.trim() ?? "";
    nameById.set(s.id, `${first} ${last}`.trim() || "Staff member");
  }

  return list.map((t) => ({
    id: t.id,
    staffId: t.staff_id,
    staffName: nameById.get(t.staff_id) ?? "Unknown staff",
    clockIn: t.clock_in,
    clockOut: t.clock_out,
    approved: t.approved,
    actualHours: t.actual_hours == null ? null : Number(t.actual_hours),
  }));
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
