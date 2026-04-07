"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type RunHistoryRow = {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

export default function ReportHistoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<RunHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        const { data, error: queryErr } = await supabase
          .from("report_runs")
          .select("id, source_type, source_id, status, started_at, completed_at")
          .eq("organization_id", ctx.ctx.organizationId)
          .order("started_at", { ascending: false })
          .limit(100);
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as RunHistoryRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load report history.");
      } finally {
        if (alive) setLoading(false);
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Export history and audit</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Trace who ran what, when it completed, and what status was recorded.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent report runs</CardTitle>
          <CardDescription>Run-level history captured in `report_runs`.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No report runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.source_type}:{row.source_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "completed" ? "secondary" : "outline"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(row.started_at).toLocaleString()}</TableCell>
                    <TableCell>{row.completed_at ? new Date(row.completed_at).toLocaleString() : "—"}</TableCell>
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
