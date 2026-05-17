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
      <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-card p-6 md:p-8 rounded-[var(--radius)] border border-border shadow-sm">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "mb-2 gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-[10px] font-bold uppercase tracking-wider text-success mb-2 block w-fit">
            <Shield className="w-3 h-3" /> Narcotics Log
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
            Controlled Substances
          </h1>
          <p className="text-sm font-medium tracking-wide text-muted-foreground mt-1">
            Shift reconciliation audit trail. Discrepancies require resolution.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => setCountModalOpen(true)}
            className="bg-success text-primary-foreground hover:bg-success/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Initiate Count
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      ) : null}

      {/* Pending Discrepancies Banner */}
      {pendingCount > 0 && (
        <div className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div>
              <p className="text-sm font-semibold text-warning">
                {pendingCount} unresolved {pendingCount === 1 ? "discrepancy" : "discrepancies"}
              </p>
              <p className="text-xs text-warning/80">
                These counts require resolution before the next shift.
              </p>
            </div>
          </div>
          <Button
            onClick={openBatchResolutionModal}
            variant="outline"
            size="sm"
            className="border-warning/30 text-warning hover:bg-warning/10"
          >
            Resolve All
          </Button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="h-10 rounded-[var(--radius)] border border-border bg-card px-3 text-sm text-foreground focus:ring-2 focus:ring-ring/50"
          >
            <option value="all">All Counts</option>
            <option value="discrepancies">With Discrepancies</option>
            <option value="pending">Pending Resolution</option>
          </select>
          <span className="text-sm text-muted-foreground tabular-nums">
            ({filteredRows.length} records)
          </span>
        </div>
          <Button
          variant="outline"
          size="sm"
          className="border-border text-muted-foreground"
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
        <div className="rounded-[var(--radius)] border border-border bg-muted/40 p-16 text-center shadow-sm">
          <Shield className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground tracking-tight">
            {filter === "all" ? "No Count Records" : `No ${filter.replace(/_/g, " ")} counts`}
          </p>
          <p className="text-sm font-medium text-muted-foreground mt-1">
            {filter === "all"
              ? "There are no controlled substance counts logged for this facility."
              : `No counts match the selected filter.`}
          </p>
          {filter !== "all" && (
            <Button
              variant="ghost"
              onClick={() => setFilter("all")}
              className="mt-4 text-success hover:bg-success/10"
            >
              View all counts
            </Button>
          )}
        </div>
      ) : (
        <div
          className="border border-border rounded-[var(--radius)] bg-card p-6 md:p-8 shadow-sm relative overflow-hidden"
        >
          {/* Table Header */}
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 px-[13px] pb-4 border-b border-border relative z-10">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Medication
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Date & Shift
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">
              Expected
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">
              Actual
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">
              Delta
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
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
                        "w-full grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 items-center min-h-[36px] px-[13px] py-3 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] tap-responsive group outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 text-left",
                        hot && "ring-1 ring-destructive/50 bg-destructive/10 hover:ring-destructive cursor-pointer",
                        !hot && resolved && "border-success/20 bg-success/10"
                      )}
                    >
                      <div className="flex flex-col min-w-0 pr-4">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Medication
                        </span>
                        <span
                          className={cn(
                            "font-semibold text-lg tracking-tight transition-colors",
                            hot
                              ? "text-destructive"
                              : resolved
                              ? "text-success"
                              : "text-foreground"
                          )}
                        >
                          {medName}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Date & Shift
                        </span>
                        <span className="text-[11px] font-mono tracking-wider text-muted-foreground whitespace-nowrap tabular-nums">
                          {r.count_date}
                        </span>
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground mt-1">
                          {r.shift} Shift
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Expected
                        </span>
                        <span className="text-lg text-muted-foreground tabular-nums">
                          {r.expected_count}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Actual
                        </span>
                        <span className="text-lg text-foreground tabular-nums">
                          {r.actual_count}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Delta
                        </span>
                        <span
                          className={cn(
                            "text-lg font-medium tabular-nums",
                            hot
                              ? "text-destructive"
                              : r.discrepancy === 0
                              ? "text-success"
                              : "text-warning"
                          )}
                        >
                          {r.discrepancy > 0 ? `+${r.discrepancy}` : r.discrepancy}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-end lg:pr-2 justify-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                          Status
                        </span>
                        {hot ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="destructive"
                              className="px-2 py-0.5 text-[9px] uppercase font-semibold tracking-wider bg-destructive/10 text-destructive border border-destructive/30"
                            >
                              Open
                            </Badge>
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          </div>
                        ) : resolved && r.discrepancy !== 0 ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className="px-2 py-0.5 text-[9px] uppercase font-semibold tracking-wider bg-success/10 text-success border border-success/30"
                            >
                              Resolved
                            </Badge>
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          </div>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="px-2 py-0.5 text-[9px] uppercase font-semibold tracking-wider bg-success/10 text-success border border-success/30"
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
