"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2 } from "lucide-react";

import { AdminFacilityScopeDropdown } from "@/components/common/admin-facility-scope-dropdown";
import { ReportRunResult } from "@/components/reports/report-run-result";
import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import {
  buildReportPrintHtml,
  detailRowsToCsv,
  summaryRowsToCsv,
} from "@/lib/reports/metric-presentation";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { executeReportTemplate, type ReportExecutionResult } from "@/lib/reports/executors";
import { resolveReportTemplateIdBySlug } from "@/lib/reports/resolve-template-id";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

function buildFullCsv(result: ReportExecutionResult): string {
  const summaryPart = summaryRowsToCsv(result.summary);
  if (result.rows.length === 0) return summaryPart;
  return `${summaryPart}\n\n${detailRowsToCsv(result.rows)}`;
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

  const scopeLabel = useMemo(() => {
    if (scopeFacilityId === null) return "All facilities";
    return (
      facilityOptions.find((f) => f.id === scopeFacilityId)?.name ?? "Selected facility"
    );
  }, [scopeFacilityId, facilityOptions]);

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
    const csv = buildFullCsv(result);
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
    const reportTitle = template?.name ?? sourceId;
    const html = buildReportPrintHtml({
      reportTitle,
      templateLabel: template?.name ?? sourceId,
      scopeLabel,
      summary: result.summary,
      footnotes: result.footnotes,
    });
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      setError("Pop-up blocked. Allow pop-ups for this site to print or save as PDF.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    const trigger = () => {
      try {
        w.print();
      } catch {
        /* ignore */
      }
    };
    if (w.document.readyState === "complete") {
      setTimeout(trigger, 0);
    } else {
      w.addEventListener("load", () => setTimeout(trigger, 0));
    }

    await supabase.from("report_exports").insert({
      organization_id: orgId,
      report_run_id: lastRunId,
      export_format: "pdf",
      file_name: `report-${sourceId}.pdf`,
    });
  }, [lastRunId, orgId, result, scopeLabel, sourceId, supabase, template?.name]);

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

      {error && (
        <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="glass-panel relative z-10 mb-6 w-full overflow-visible rounded-[2rem] border border-slate-200 bg-white/40 p-6 shadow-sm backdrop-blur-3xl transition-all dark:border-white/5 dark:bg-black/20 sm:p-8">
        <div className="mb-6">
          <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
            Execution
          </h3>
          <p className="font-mono text-sm text-slate-500 dark:text-slate-400">
            Set scope and run now. Every run is recorded in report history.
          </p>
        </div>
        <div className="space-y-6">
          <div className="grid max-w-lg gap-2">
            <Label
              htmlFor="report-facility-scope"
              className="flex items-center gap-2 text-[10px] font-bold font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400"
            >
              <Building2 className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
              Facility scope
            </Label>
            <p
              id="report-facility-scope-hint"
              className="text-xs leading-relaxed text-slate-600 dark:text-slate-400"
            >
              Run for one site or across all facilities in your organization. When the header has a
              single facility selected, this scope starts aligned with it—you can switch to
              organization-wide anytime.
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
              triggerClassName="rounded-2xl border-slate-200 bg-white/70 py-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-black/30"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              className="h-10 rounded-full border-0 bg-indigo-600 px-8 font-mono text-[10px] font-semibold uppercase tracking-widest text-white shadow-lg hover:-translate-y-0.5 hover:bg-indigo-700"
              onClick={() => void onRun()}
              disabled={running || !orgId}
            >
              {running ? "Running..." : "Run report"}
            </Button>
            <Button
              variant="secondary"
              className="h-10 rounded-full border border-slate-200 bg-slate-100 px-6 font-mono text-[10px] uppercase tracking-widest text-slate-900 shadow-sm hover:-translate-y-0.5 hover:bg-slate-200 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
              onClick={() => void onExportCsv()}
              disabled={!result}
            >
              Download CSV
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-full border border-slate-300 bg-transparent px-6 font-mono text-[10px] uppercase tracking-widest text-slate-700 hover:-translate-y-0.5 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
              onClick={() => void onPrint()}
              disabled={!result}
            >
              Print / PDF
            </Button>
          </div>
        </div>
      </div>

      {result && (
        <div className="glass-panel relative z-10 w-full overflow-visible rounded-[2rem] border border-slate-200 bg-white/40 p-6 shadow-sm backdrop-blur-3xl transition-all dark:border-white/5 dark:bg-black/20 sm:p-8">
          <div className="mb-6">
            <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              Run result
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Scope: <span className="font-medium text-slate-800 dark:text-slate-200">{scopeLabel}</span>
            </p>
          </div>
          <ReportRunResult summary={result.summary} detailRows={result.rows} />
          {result.footnotes && result.footnotes.length > 0 && (
            <div className="mt-8 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Notes
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {result.footnotes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
