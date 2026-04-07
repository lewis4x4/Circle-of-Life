"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { executeReportTemplate, type ReportExecutionResult } from "@/lib/reports/executors";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function rowsToCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => escape(String(row[key] ?? ""))).join(",")),
  ];
  return lines.join("\n");
}

export default function ReportRunPage() {
  const supabase = createClient();
  const params = useParams<{ sourceType: string; id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportExecutionResult | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);

  const sourceType = params.sourceType ?? "template";
  const sourceId = params.id ?? "";
  const template = useMemo(
    () => PHASE1_TEMPLATE_SEED.find((item) => item.slug === sourceId),
    [sourceId],
  );

  useEffect(() => {
    void (async () => {
      const ctx = await loadReportsRoleContext(supabase);
      if (ctx.ok) setOrgId(ctx.ctx.organizationId);
      else setError(ctx.error);
    })();
  }, [supabase]);

  const onRun = useCallback(async () => {
    if (!orgId) return;
    setRunning(true);
    setError(null);
    try {
      const { data: runRow, error: runErr } = await supabase
        .from("report_runs")
        .insert({
          organization_id: orgId,
          source_type: sourceType as "template" | "saved_view" | "pack",
          source_id: sourceId,
          status: "running",
          run_scope_json: facilityId ? { facility_id: facilityId } : {},
        })
        .select("id")
        .single();
      if (runErr) throw new Error(runErr.message);

      const execution = await executeReportTemplate(sourceId, {
        supabase,
        organizationId: orgId,
        facilityId: facilityId || null,
      });
      setResult(execution);
      setLastRunId(runRow.id);

      const { error: doneErr } = await supabase
        .from("report_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          filter_snapshot_json: facilityId ? { facilityId } : {},
        })
        .eq("id", runRow.id)
        .eq("organization_id", orgId);
      if (doneErr) throw new Error(doneErr.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }, [facilityId, orgId, sourceId, sourceType, supabase]);

  const onExportCsv = useCallback(async () => {
    if (!result || !orgId || !lastRunId) return;
    const csv = rowsToCsv(result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const datePart = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `report-${sourceId}-${datePart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    await supabase.from("report_exports").insert({
      organization_id: orgId,
      report_run_id: lastRunId,
      export_format: "csv",
      file_name: `report-${sourceId}-${datePart}.csv`,
    });
  }, [lastRunId, orgId, result, sourceId, supabase]);

  const onPrint = useCallback(async () => {
    if (!result || !orgId || !lastRunId) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${sourceId}</title>
      <style>body{font-family:system-ui;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}</style>
      </head><body><h1>${template?.name ?? sourceId}</h1>
      <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
      ${result.summary.map((row) => `<tr><td>${row.key}</td><td>${row.value ?? "—"}</td></tr>`).join("")}
      </tbody></table></body></html>`;
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      setError("Pop-up blocked. Allow pop-ups to print.");
      return;
    }
    popup.document.write(html);
    popup.document.close();
    popup.print();

    await supabase.from("report_exports").insert({
      organization_id: orgId,
      report_run_id: lastRunId,
      export_format: "pdf",
      file_name: `report-${sourceId}.pdf`,
    });
  }, [lastRunId, orgId, result, sourceId, supabase, template?.name]);

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            Run report: {template?.name ?? sourceId}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Source type: <Badge variant="outline">{sourceType}</Badge>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/reports/templates" className={cn(buttonVariants({ variant: "outline" }))}>
            Back to templates
          </Link>
        </div>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Execution</CardTitle>
          <CardDescription>Set scope and run now. Every run is recorded in report history.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 max-w-md">
            <label htmlFor="facility-id" className="text-sm font-medium">
              Optional facility scope (UUID)
            </label>
            <input
              id="facility-id"
              value={facilityId}
              onChange={(event) => setFacilityId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              placeholder="Leave empty for organization scope"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onRun()} disabled={running || !orgId}>
              {running ? "Running..." : "Run report"}
            </Button>
            <Button variant="secondary" onClick={() => void onExportCsv()} disabled={!result}>
              Download CSV
            </Button>
            <Button variant="outline" onClick={() => void onPrint()} disabled={!result}>
              Print / PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Run result preview</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.summary.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{row.value == null ? "—" : String(row.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
