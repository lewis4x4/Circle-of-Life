"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Shield,
  Plus,
  Filter,
  Download,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { CountInitiationModal } from "@/components/medication/CountInitiationModal";
import { DiscrepancyResolutionModal, type DiscrepancyRecord } from "@/components/medication/DiscrepancyResolutionModal";

type Row = {
  id: string;
  count_date: string;
  shift: string;
  expected_count: number;
  actual_count: number;
  discrepancy: number;
  discrepancy_resolved: boolean | null;
  resolution_notes: string | null;
  resident_medications: {
    id: string;
    medication_name: string;
  } | null;
};

type FilterType = "all" | "discrepancies" | "pending";

export default function AdminControlledSubstancesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [countModalOpen, setCountModalOpen] = useState(false);
  const [resolutionModalOpen, setResolutionModalOpen] = useState(false);
  const [selectedDiscrepancies, setSelectedDiscrepancies] = useState<DiscrepancyRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility.");
      return;
    }
    try {
      const res = await supabase
        .from("controlled_substance_counts")
        .select(
          `
          id,
          count_date,
          shift,
          expected_count,
          actual_count,
          discrepancy,
          discrepancy_resolved,
          resolution_notes,
          resident_medications ( id, medication_name )
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("count_date", { ascending: false })
        .limit(200);

      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "discrepancies") {
      return rows.filter((r) => r.discrepancy !== 0);
    }
    if (filter === "pending") {
      return rows.filter((r) => r.discrepancy !== 0 && !r.discrepancy_resolved);
    }
    return rows;
  }, [rows, filter]);

  const openResolutionModal = (row: Row) => {
    setSelectedDiscrepancies([
      {
        id: row.id,
        medicationName: row.resident_medications?.medication_name || "Unknown",
        countDate: row.count_date,
        shift: row.shift,
        expectedCount: row.expected_count,
        actualCount: row.actual_count,
        discrepancy: row.discrepancy,
        resolutionNotes: row.resolution_notes,
        discrepancyResolved: row.discrepancy_resolved,
      },
    ]);
    setResolutionModalOpen(true);
  };

  const handleResolve = async (ids: string[], notes: string) => {
    const { error } = await supabase
      .from("controlled_substance_counts")
      .update({
        discrepancy_resolved: true,
        resolution_notes: notes,
        resolved_at: new Date().toISOString(),
      })
      .in("id", ids);

    if (error) throw error;
    await load();
  };

  const openBatchResolutionModal = () => {
    const pending = rows
      .filter((r) => r.discrepancy !== 0 && !r.discrepancy_resolved)
      .map((r) => ({
        id: r.id,
        medicationName: r.resident_medications?.medication_name || "Unknown",
        countDate: r.count_date,
        shift: r.shift,
        expectedCount: r.expected_count,
        actualCount: r.actual_count,
        discrepancy: r.discrepancy,
        resolutionNotes: r.resolution_notes,
        discrepancyResolved: r.discrepancy_resolved,
      }));

    if (pending.length === 0) return;
    setSelectedDiscrepancies(pending);
    setResolutionModalOpen(true);
  };

  const pendingCount = rows.filter((r) => r.discrepancy !== 0 && !r.discrepancy_resolved).length;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-6 md:p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "mb-2 gap-1 px-0 text-slate-500 hover:bg-transparent hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-2 block w-fit">
            <Shield className="w-3 h-3" /> Narcotics Log
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight text-slate-900 dark:text-white">
            Controlled Substances
          </h1>
          <p className="text-sm font-medium tracking-wide text-slate-600 dark:text-slate-400 mt-1">
            Shift reconciliation audit trail. Discrepancies require resolution.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => setCountModalOpen(true)}
            className="bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-500/20"
          >
            <Plus className="mr-2 h-4 w-4" />
            Initiate Count
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 px-6 py-4 text-sm text-rose-700 dark:text-rose-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      ) : null}

      {/* Pending Discrepancies Banner */}
      {pendingCount > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {pendingCount} unresolved {pendingCount === 1 ? "discrepancy" : "discrepancies"}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                These counts require resolution before the next shift.
              </p>
            </div>
          </div>
          <Button
            onClick={openBatchResolutionModal}
            variant="outline"
            size="sm"
            className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            Resolve All
          </Button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-3 text-sm text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="all">All Counts</option>
            <option value="discrepancies">With Discrepancies</option>
            <option value="pending">Pending Resolution</option>
          </select>
          <span className="text-sm text-slate-500">
            ({filteredRows.length} records)
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
          onClick={() => {
            const csv = filteredRows.map((r) =>
              [
                r.resident_medications?.medication_name || "Unknown",
                r.count_date,
                r.shift,
                r.expected_count,
                r.actual_count,
                r.discrepancy,
                r.discrepancy_resolved ? "Resolved" : "Open",
                r.resolution_notes || "",
              ].join(",")
            ).join("\n");
            const header = "Medication,Date,Shift,Expected,Actual,Delta,Status,Notes\n";
            const blob = new Blob([header + csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `controlled-substances-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Count List */}
      {loading ? (
        <AdminTableLoadingState />
      ) : filteredRows.length === 0 ? (
        <div className="rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] p-16 text-center backdrop-blur-3xl shadow-sm">
          <Shield className="h-16 w-16 text-slate-300 dark:text-zinc-700 mx-auto mb-4" />
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            {filter === "all" ? "No Count Records" : `No ${filter.replace(/_/g, " ")} counts`}
          </p>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 mt-1">
            {filter === "all"
              ? "There are no controlled substance counts logged for this facility."
              : `No counts match the selected filter.`}
          </p>
          {filter !== "all" && (
            <Button
              variant="ghost"
              onClick={() => setFilter("all")}
              className="mt-4 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              View all counts
            </Button>
          )}
        </div>
      ) : (
        <div
          className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] p-6 md:p-8 shadow-sm backdrop-blur-3xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

          {/* Table Header */}
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              Medication
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              Date & Shift
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">
              Expected
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">
              Actual
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">
              Delta
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">
              Status
            </div>
          </div>

          {/* Table Body */}
          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {filteredRows.map((r) => {
                const medName = r.resident_medications?.medication_name ?? "—";
                const hot = r.discrepancy !== 0 && !r.discrepancy_resolved;
                const resolved = r.discrepancy_resolved;

                return (
                  <MotionItem key={r.id}>
                    <button
                      onClick={() => hot && openResolutionModal(r)}
                      className={cn(
                        "w-full grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-emerald-200 dark:hover:border-emerald-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 outline-none text-left",
                        hot && "ring-1 ring-red-500/50 bg-red-50/50 dark:bg-red-500/5 hover:ring-red-500 dark:hover:ring-red-500 cursor-pointer",
                        !hot && resolved && "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5"
                      )}
                    >
                      <div className="flex flex-col min-w-0 pr-4">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Medication
                        </span>
                        <span
                          className={cn(
                            "font-semibold text-lg text-slate-900 dark:text-white tracking-tight transition-colors",
                            hot
                              ? "text-red-700 dark:text-red-400"
                              : resolved
                              ? "text-emerald-700 dark:text-emerald-500"
                              : "group-hover:text-emerald-700 dark:group-hover:text-emerald-400"
                          )}
                        >
                          {medName}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Date & Shift
                        </span>
                        <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                          {r.count_date}
                        </span>
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">
                          {r.shift} Shift
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Expected
                        </span>
                        <span className="text-lg font-display text-slate-600 dark:text-slate-400">
                          {r.expected_count}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Actual
                        </span>
                        <span className="text-lg font-display text-slate-900 dark:text-slate-200">
                          {r.actual_count}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Delta
                        </span>
                        <span
                          className={cn(
                            "text-lg font-display font-medium",
                            hot
                              ? "text-red-600 dark:text-red-400"
                              : r.discrepancy === 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {r.discrepancy > 0 ? `+${r.discrepancy}` : r.discrepancy}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-end lg:pr-2 justify-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                          Status
                        </span>
                        {hot ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="destructive"
                              className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400"
                            >
                              Open
                            </Badge>
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          </div>
                        ) : resolved && r.discrepancy !== 0 ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                            >
                              Resolved
                            </Badge>
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          </div>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                          >
                            OK
                          </Badge>
                        )}
                      </div>
                    </button>
                  </MotionItem>
                );
              })}
            </MotionList>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedFacilityId && (
        <CountInitiationModal
          open={countModalOpen}
          onOpenChange={setCountModalOpen}
          facilityId={selectedFacilityId}
          onSuccess={load}
        />
      )}
      <DiscrepancyResolutionModal
        open={resolutionModalOpen}
        onOpenChange={setResolutionModalOpen}
        discrepancies={selectedDiscrepancies}
        onResolve={handleResolve}
      />
    </div>
  );
}
