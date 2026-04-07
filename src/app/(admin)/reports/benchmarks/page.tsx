"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type BenchmarkRow = {
  id: string;
  metric_key: string;
  benchmark_type: string;
  scope_type: string;
  effective_from: string;
  effective_to: string | null;
};

export default function ReportsBenchmarksPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        const { data, error: queryErr } = await supabase
          .from("report_benchmarks")
          .select("id, metric_key, benchmark_type, scope_type, effective_from, effective_to")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("effective_from", { ascending: false });
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as BenchmarkRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load benchmarks.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Benchmark comparisons</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compare facilities to portfolio, target thresholds, and prior periods.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Defined benchmarks</CardTitle>
          <CardDescription>Central benchmark definitions used by report templates.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No benchmark definitions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Window</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.metric_key}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.benchmark_type}</Badge>
                    </TableCell>
                    <TableCell>{row.scope_type}</TableCell>
                    <TableCell>
                      {row.effective_from} - {row.effective_to ?? "open"}
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
