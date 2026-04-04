"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  error_type: string;
  severity: string;
  occurred_at: string;
  reviewed_at: string | null;
};

export default function AdminMedicationErrorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<{ n: number; bySeverity: Record<string, number> }>({
    n: 0,
    bySeverity: {},
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setTotals({ n: 0, bySeverity: {} });
      setLoading(false);
      setError("Select a facility.");
      return;
    }
    try {
      const res = await supabase
        .from("medication_errors")
        .select("id, error_type, severity, occurred_at, reviewed_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(150);

      if (res.error) throw res.error;
      const list = (res.data ?? []) as Row[];
      setRows(list);
      const bySeverity: Record<string, number> = {};
      for (const r of list) {
        bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      }
      setTotals({ n: list.length, bySeverity });
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0")}
          >
            <ArrowLeft className="h-4 w-4" />
            Medications
          </Link>
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Medication errors
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Structured reports (aggregate view — no staff names on charts in later iterations).
          </p>
        </div>
        <Link href="/admin/medications/errors/new" className={cn(buttonVariants(), "w-fit")}>
          Report error
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs font-medium uppercase text-slate-500">In view</p>
          <p className="font-display text-2xl font-semibold">{totals.n}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:col-span-2">
          <p className="text-xs font-medium uppercase text-slate-500">By severity (sample)</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {Object.entries(totals.bySeverity).length === 0
              ? "—"
              : Object.entries(totals.bySeverity)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No medication errors for this facility.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Occurred</TableHead>
                <TableHead>Reviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">{r.error_type.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {r.severity.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">
                    {new Date(r.occurred_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
