"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Banknote, Download, Search } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type BatchRow = Database["public"]["Tables"]["payroll_export_batches"]["Row"];
type PayrollBatchStatus = Database["public"]["Enums"]["payroll_export_batch_status"];

const BATCH_STATUS_FILTERS: { value: "all" | PayrollBatchStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "queued", label: "Queued" },
  { value: "exported", label: "Exported" },
  { value: "failed", label: "Failed" },
  { value: "voided", label: "Voided" },
];

function buildPayrollBatchesCsv(rows: BatchRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "period_start",
    "period_end",
    "provider",
    "status",
    "notes",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.period_start),
      csvEscapeCell(row.period_end),
      csvEscapeCell(row.provider),
      csvEscapeCell(row.status),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminPayrollHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | PayrollBatchStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => {
      const hay = [r.period_start, r.period_end, r.provider, r.notes, r.id, r.status]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filteredRows, searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("payroll_export_batches")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("period_start", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payroll export batches.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportBatchesCsv = async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      let query = supabase
        .from("payroll_export_batches")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("period_start", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      const batchRows = (data ?? []) as BatchRow[];
      const csv = buildPayrollBatchesCsv(batchRows);
      const stamp = format(new Date(), "yyyy-MM-dd");
      const base = `payroll-export-batches-${stamp}`;
      const filename =
        statusFilter === "all" ? `${base}.csv` : `${base}_${statusFilter}.csv`;
      triggerCsvDownload(filename, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export payroll batches.");
    } finally {
      setExportingCsv(false);
    }
  };

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-emerald-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 13 / Payroll</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Payroll Export
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
              <Sparkline colorClass="text-emerald-500" variant={3} />
              <MonolithicWatermark value={displayRows.length} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <Banknote className="h-3.5 w-3.5" /> Export Batches
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">
                  {displayRows.length}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Batches for external payroll systems. Idempotency enforced.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/payroll/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-600 border-none")} >
                     + New Batch
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load payroll export batches.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <div className="relative overflow-visible z-10 w-full mt-4">
        <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Batches</h3>
                <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
                  Pay period window and provider label. Open a batch for line items and line-level CSV; list batch metadata
                  export below.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!facilityReady || exportingCsv}
                className="h-11 shrink-0 gap-2 rounded-full font-mono text-[10px] font-bold uppercase tracking-widest"
                title={
                  (statusFilter === "all"
                    ? "Export up to 500 batches (all statuses), most recent period first."
                    : `Export up to 500 ${statusFilter} batches, most recent period first.`) +
                  " Search does not narrow the CSV."
                }
                onClick={() => void exportBatchesCsv()}
              >
                <Download className="h-4 w-4" aria-hidden />
                {exportingCsv ? "Preparing…" : "Download batches CSV"}
              </Button>
            </div>
            {facilityReady ? (
              <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-md">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <Input
                    type="search"
                    placeholder="Search period, provider, notes, id…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-lg border-slate-200 bg-white text-sm dark:border-white/10 dark:bg-white/5"
                    aria-label="Filter batches by text"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Status</span>
                  <select
                    className={cn(
                      "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100",
                      "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | PayrollBatchStatus)}
                  >
                    {BATCH_STATUS_FILTERS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {rows.length > 0 ? (
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
                    {searchQuery.trim() ? (
                      <>
                        Showing {displayRows.length} of {filteredRows.length} · Search
                      </>
                    ) : (
                      <>
                        Showing {filteredRows.length} of {rows.length} · Period desc
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        
        {loading ? (
           <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : !facilityReady ? null : rows.length === 0 ? (
           <p className="text-sm font-mono text-slate-500">No payroll export batches for this facility yet.</p>
        ) : filteredRows.length === 0 ? (
           <p className="text-sm font-mono text-slate-500">No batches match this status filter.</p>
        ) : displayRows.length === 0 ? (
           <p className="text-sm font-mono text-slate-500">No batches match this search.</p>
        ) : (
          <MotionList className="space-y-3">
             {displayRows.map((row) => (
               <MotionItem key={row.id}>
                 <Link
                   href={`/admin/payroll/${row.id}`}
                   className="block p-4 sm:p-5 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-emerald-500/30 hover:bg-white/70 dark:hover:bg-emerald-900/10 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex flex-col md:flex-row md:items-center justify-between gap-4"
                 >
                    
                    <div className="flex flex-col min-w-[200px] gap-1">
                       <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Period</span>
                       <span className="font-bold font-mono text-slate-900 dark:text-slate-100 uppercase tracking-widest text-xs">
                          {row.period_start} → {row.period_end}
                       </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full items-center">
                       <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Provider</span>
                          <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">{row.provider}</span>
                       </div>
                       <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                          <span className={cn("font-mono text-xs font-bold uppercase tracking-widest", row.status === "exported" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500")}>
                             {formatStatus(row.status)}
                          </span>
                       </div>
                       <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Updated</span>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                             {format(new Date(row.updated_at), "MMM d, yyyy")}
                          </span>
                       </div>
                    </div>
                    
                 </Link>
               </MotionItem>
             ))}
          </MotionList>
        )}
      </div>
      </div>
    </div>
  );
}
