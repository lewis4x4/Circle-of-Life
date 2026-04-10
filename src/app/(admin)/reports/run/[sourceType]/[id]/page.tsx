"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2 } from "lucide-react";

import { AdminFacilityScopeDropdown } from "@/components/common/admin-facility-scope-dropdown";
import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { executeReportTemplate, type ReportExecutionResult } from "@/lib/reports/executors";
import { resolveReportTemplateIdBySlug } from "@/lib/reports/resolve-template-id";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

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
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const storeFacilities = useFacilityStore((s) => s.availableFacilities);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportExecutionResult | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  /** `null` = organization-wide; otherwise a facility UUID */
  const [scopeFacilityId, setScopeFacilityId] = useState<string | null>(null);
  const [facilityOptions, setFacilityOptions] = useState<{ id: string; name: string }[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
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

  const loadFacilityOptions = useCallback(async () => {
    setFacilitiesLoading(true);
    setFacilitiesLoadFailed(false);
    try {
      const fromStore = storeFacilities.length > 0 ? storeFacilities : null;
      const list = fromStore ?? (await fetchAdminFacilityOptions());
      setFacilityOptions(list.map((f) => ({ id: f.id, name: f.name })));
    } catch {
      setFacilityOptions([]);
      setFacilitiesLoadFailed(true);
    } finally {
      setFacilitiesLoading(false);
    }
  }, [storeFacilities]);

  useEffect(() => {
    void loadFacilityOptions();
  }, [loadFacilityOptions]);

  useEffect(() => {
    if (selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId)) {
      setScopeFacilityId(selectedFacilityId);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    if (facilitiesLoading) return;
    if (
      scopeFacilityId !== null &&
      !facilityOptions.some((f) => f.id === scopeFacilityId)
    ) {
      setScopeFacilityId(null);
    }
  }, [facilitiesLoading, facilityOptions, scopeFacilityId]);

  const onRun = useCallback(async () => {
    if (!orgId) return;
    setRunning(true);
    setError(null);
    try {
      const scopedFacilityId =
        scopeFacilityId !== null && isValidFacilityIdForQuery(scopeFacilityId)
          ? scopeFacilityId
          : null;

      const resolved = await resolveReportTemplateIdBySlug(supabase, sourceId, orgId);
      if ("error" in resolved) throw new Error(resolved.error);

      const { data: runRow, error: runErr } = await supabase
        .from("report_runs")
        .insert({
          organization_id: orgId,
          source_type: sourceType as "template" | "saved_view" | "pack",
          source_id: resolved.id,
          template_id: resolved.id,
          status: "running",
          run_scope_json: scopedFacilityId ? { facility_id: scopedFacilityId } : {},
        })
        .select("id")
        .single();
      if (runErr) throw new Error(runErr.message);

      const execution = await executeReportTemplate(sourceId, {
        supabase,
        organizationId: orgId,
        facilityId: scopedFacilityId,
      });
      setResult(execution);
      setLastRunId(runRow.id);

      const { error: doneErr } = await supabase
        .from("report_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          filter_snapshot_json: scopedFacilityId ? { facilityId: scopedFacilityId } : {},
        })
        .eq("id", runRow.id)
        .eq("organization_id", orgId);
      if (doneErr) throw new Error(doneErr.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }, [orgId, scopeFacilityId, sourceId, sourceType, supabase]);

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
          <Link
            href="/admin/reports/templates"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to templates
          </Link>
        </div>
      </div>

      {error && <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400 font-medium">{error}</p>}

      <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl shadow-sm relative overflow-visible mb-6 z-10 w-full transition-all">
          <div className="mb-6">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Execution</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Set scope and run now. Every run is recorded in report history.</p>
          </div>
          <div className="space-y-6">
            <div className="grid gap-2 max-w-lg">
              <Label
                htmlFor="report-facility-scope"
                className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold"
              >
                <Building2 className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
                Facility scope
              </Label>
              <p id="report-facility-scope-hint" className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Run for one site or across all facilities in your organization. When the header has a single facility
                selected, this scope starts aligned with it—you can switch to organization-wide anytime.
              </p>
              <AdminFacilityScopeDropdown
                id="report-facility-scope"
                describedBy="report-facility-scope-hint"
                value={scopeFacilityId}
                onChange={setScopeFacilityId}
                facilities={facilityOptions}
                loading={facilitiesLoading}
                loadFailed={facilitiesLoadFailed}
                onRetry={() => void loadFacilityOptions()}
                disabled={running}
                triggerClassName="rounded-2xl border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/30 backdrop-blur-xl shadow-sm py-3"
              />
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Button className="rounded-full font-mono uppercase tracking-widest text-[10px] h-10 hover:-translate-y-0.5 transition-transform shadow-lg px-8 bg-indigo-600 hover:bg-indigo-700 text-white border-0" onClick={() => void onRun()} disabled={running || !orgId}>
                {running ? "Running..." : "Run report"}
              </Button>
              <Button variant="secondary" className="rounded-full font-mono uppercase tracking-widest text-[10px] h-10 hover:-translate-y-0.5 transition-transform shadow-sm px-6 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-white/10" onClick={() => void onExportCsv()} disabled={!result}>
                Download CSV
              </Button>
              <Button variant="outline" className="rounded-full font-mono uppercase tracking-widest text-[10px] h-10 hover:-translate-y-0.5 transition-transform shadow-sm px-6 border border-slate-300 dark:border-white/10 bg-transparent hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300" onClick={() => void onPrint()} disabled={!result}>
                Print / PDF
              </Button>
            </div>
          </div>
      </div>

      {result && (
        <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Run result preview</h3>
          </div>
            <MotionList className="space-y-3">
                {result.summary.map((row) => (
                  <MotionItem key={row.key}>
                    <div className="p-4 rounded-xl glass-panel border border-slate-200 dark:border-white/5 bg-white/60 dark:bg-slate-900/40 w-full flex items-center justify-between gap-6 backdrop-blur-xl shadow-sm">
                       <span className="font-mono text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
                           {row.key}
                       </span>
                       <span className="font-bold font-mono text-slate-900 dark:text-slate-100 text-sm">
                           {row.value == null ? "—" : String(row.value)}
                       </span>
                    </div>
                  </MotionItem>
                ))}
            </MotionList>
        </div>
      )}
    </div>
  );
}
