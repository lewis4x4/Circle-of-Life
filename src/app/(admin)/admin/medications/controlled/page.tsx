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
  count_date: string;
  shift: string;
  expected_count: number;
  actual_count: number;
  discrepancy: number;
  discrepancy_resolved: boolean | null;
  resident_medications: { medication_name: string } | null;
};

export default function AdminControlledSubstancesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

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
          resident_medications ( medication_name )
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/medications"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0")}
        >
          <ArrowLeft className="h-4 w-4" />
          Medications
        </Link>
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Controlled substance counts
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Shift reconciliation audit trail. Discrepancies highlight until resolved.
        </p>
      </div>

      {error ? <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No count records for this facility.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medication</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Δ</TableHead>
                <TableHead>Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const medName = r.resident_medications?.medication_name ?? "—";
                const hot = r.discrepancy !== 0 && !r.discrepancy_resolved;
                return (
                  <TableRow key={r.id} className={hot ? "bg-red-50/80 dark:bg-red-950/30" : undefined}>
                    <TableCell className="font-medium">{medName}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.count_date}</TableCell>
                    <TableCell className="capitalize">{r.shift}</TableCell>
                    <TableCell>{r.expected_count}</TableCell>
                    <TableCell>{r.actual_count}</TableCell>
                    <TableCell>{r.discrepancy}</TableCell>
                    <TableCell>
                      {hot ? (
                        <Badge variant="destructive">Open</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
