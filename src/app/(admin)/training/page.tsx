"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { GraduationCap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type DemoRow = Database["public"]["Tables"]["competency_demonstrations"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminTrainingHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DemoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .from("competency_demonstrations")
        .select("*, staff(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("demonstrated_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data ?? []) as DemoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competency demonstrations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Training & competency
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Documented skills demonstrations for the selected facility (evaluator sign-off).
          </p>
        </div>
        <Link
          href="/admin/training/new"
          className={cn(buttonVariants({ variant: "default" }), "inline-flex items-center gap-2 self-start")}
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
          New demonstration
        </Link>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load competency demonstrations.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Demonstrations</CardTitle>
          <CardDescription>
            Skills checklist JSON and attachment paths are stored on each row; file uploads are Enhanced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !facilityReady ? null : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No competency demonstrations for this facility yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Demonstrated</TableHead>
                  <TableHead>Evaluator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(row.demonstrated_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {row.evaluator_user_id.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
