"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, Users } from "lucide-react";

import { AdminEmptyState, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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
            "Live data returned no ratio snapshots for the selected facility or organization filter. Use Add snapshot or record coverage from your staffing tools.",
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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={nonCompliant > 0} 
        primaryClass="bg-slate-700/10"
        secondaryClass="bg-indigo-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 18 / Staffing Models</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Ratio Analysis {nonCompliant > 0 && <PulseDot />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="rose" className="border-red-500/20 dark:border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]">
              <Sparkline colorClass="text-red-500" variant={4} />
              <MonolithicWatermark value={nonCompliant} className="text-red-600/5 dark:text-red-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-red-600 dark:text-red-400 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" /> Below Requirement
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1">{nonCompliant}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-3 h-[160px]">
            <V2Card hoverColor="indigo" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Point-in-time coverage snapshots versus required ratios.</p>
                 <Link href="/admin/staffing/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                   + Log Snapshot
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

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
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
          <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Ratio snapshots</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Lower ratio means more staff per resident (varies by operator policy).</p>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
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
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group">
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
          </div>
        </div>
      ) : null}
      </div>
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
