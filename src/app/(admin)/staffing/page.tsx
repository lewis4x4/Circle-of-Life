"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Users } from "lucide-react";

import { AdminEmptyState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SnapshotRow = {
  id: string;
  snapshotAt: string;
  shift: string;
  residentsPresent: number;
  staffOnDuty: number;
  ratio: number;
  requiredRatio: number;
  isCompliant: boolean;
};

type SupabaseSnapshotRow = {
  id: string;
  snapshot_at: string;
  shift: string;
  residents_present: number;
  staff_on_duty: number;
  ratio: number | string;
  required_ratio: number | string;
  is_compliant: boolean;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

const DEFAULT_FILTERS = { shift: "all", compliance: "all" };

export default function AdminStaffingPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState(DEFAULT_FILTERS.shift);
  const [compliance, setCompliance] = useState(DEFAULT_FILTERS.compliance);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchSnapshotsFromSupabase(selectedFacilityId);
      setRows(live);
    } catch {
      setRows(mockSnapshots);
      setError("Live staffing snapshots are unavailable. Showing demo ratios.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesShift = shift === "all" || row.shift === shift;
      const matchesCompliance =
        compliance === "all" ||
        (compliance === "ok" && row.isCompliant) ||
        (compliance === "risk" && !row.isCompliant);
      return matchesShift && matchesCompliance;
    });
  }, [rows, shift, compliance]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No staffing snapshots in this scope",
          description:
            "Live data returned no ratio snapshots for the selected facility or organization filter. Snapshots appear as they are recorded.",
        },
        whenFiltersExcludeAll: {
          title: "No staffing snapshots match the current filters",
          description:
            "Snapshots are recorded per facility and shift. Select a facility or widen filters.",
        },
      }),
    [rows.length],
  );

  const nonCompliant = rows.filter((r) => !r.isCompliant).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Staffing ratios
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Point-in-time coverage snapshots versus required ratios.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-red-200 bg-red-50 px-3 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        >
          <Users className="mr-1 h-3.5 w-3.5" />
          {nonCompliant} non-compliant
        </Badge>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Shift filter"
          >
            <option value="all">All shifts</option>
            <option value="day">Day</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
            <option value="custom">Custom</option>
          </select>
          <select
            value={compliance}
            onChange={(e) => setCompliance(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Compliance filter"
          >
            <option value="all">All snapshots</option>
            <option value="ok">Compliant</option>
            <option value="risk">Below requirement</option>
          </select>
          <Button
            variant="outline"
            className="h-10 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            type="button"
            onClick={() => {
              setShift(DEFAULT_FILTERS.shift);
              setCompliance(DEFAULT_FILTERS.compliance);
            }}
          >
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            Reset
          </Button>
        </div>
      </div>

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
            <CardTitle className="text-lg">Ratio snapshots</CardTitle>
            <CardDescription>Lower ratio means more staff per resident (varies by operator policy).</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="hidden sm:table-cell">Residents</TableHead>
                  <TableHead className="hidden sm:table-cell">Staff</TableHead>
                  <TableHead>Ratio</TableHead>
                  <TableHead className="hidden md:table-cell">Required</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {formatDateTime(row.snapshotAt)}
                    </TableCell>
                    <TableCell>
                      <ShiftBadge shift={row.shift} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{row.residentsPresent}</TableCell>
                    <TableCell className="hidden sm:table-cell">{row.staffOnDuty}</TableCell>
                    <TableCell className="font-medium tabular-nums">{row.ratio.toFixed(2)}</TableCell>
                    <TableCell className="hidden tabular-nums text-slate-600 dark:text-slate-400 md:table-cell">
                      {row.requiredRatio.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {row.isCompliant ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Compliant
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                          Below req.
                        </Badge>
                      )}
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

async function fetchSnapshotsFromSupabase(selectedFacilityId: string | null): Promise<SnapshotRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("staffing_ratio_snapshots" as never)
    .select("id, snapshot_at, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant")
    .order("snapshot_at", { ascending: false })
    .limit(150);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseSnapshotRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  return list.map((r) => ({
    id: r.id,
    snapshotAt: r.snapshot_at,
    shift: r.shift,
    residentsPresent: r.residents_present,
    staffOnDuty: r.staff_on_duty,
    ratio: Number(r.ratio),
    requiredRatio: Number(r.required_ratio),
    isCompliant: r.is_compliant,
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

function ShiftBadge({ shift }: { shift: string }) {
  const label =
    shift === "day"
      ? "Day"
      : shift === "evening"
        ? "Evening"
        : shift === "night"
          ? "Night"
          : shift === "custom"
            ? "Custom"
            : shift;
  return <Badge variant="outline">{label}</Badge>;
}

const mockSnapshots: SnapshotRow[] = [
  {
    id: "snap-demo-1",
    snapshotAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    shift: "day",
    residentsPresent: 42,
    staffOnDuty: 9,
    ratio: 4.67,
    requiredRatio: 8,
    isCompliant: true,
  },
  {
    id: "snap-demo-2",
    snapshotAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    shift: "evening",
    residentsPresent: 40,
    staffOnDuty: 5,
    ratio: 8,
    requiredRatio: 8,
    isCompliant: true,
  },
  {
    id: "snap-demo-3",
    snapshotAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    shift: "night",
    residentsPresent: 38,
    staffOnDuty: 3,
    ratio: 12.67,
    requiredRatio: 10,
    isCompliant: false,
  },
];
