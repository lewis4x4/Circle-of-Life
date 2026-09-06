"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Building2 } from "lucide-react";

import { AdminFacilityScopeDropdown } from "@/components/common/admin-facility-scope-dropdown";
import { ReportRunResult } from "@/components/reports/report-run-result";
import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import {
  buildReportPrintHtml,
  escapeHtml,
  detailRowsToCsv,
  summaryRowsToCsv,
} from "@/lib/reports/metric-presentation";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { executeReportTemplate, type ReportExecutionResult } from "@/lib/reports/executors";
import { runTemplateAndPersist, finishReportRun, failReportRun } from "@/lib/reports/run-persistence";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

function buildFullCsv(result: ReportExecutionResult): string {
  const summaryPart = summaryRowsToCsv(result.summary);
  if (result.rows.length === 0) return summaryPart;
  return `${summaryPart}\n\n${detailRowsToCsv(result.rows)}`;
}

const PACK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractSheetHtml(printDoc: string): string {
  const m = printDoc.match(/<div class="sheet">[\s\S]*?<\/div>\s*<\/body>/i);
  return m ? m[0].replace(/\s*<\/body>\s*$/i, "") : printDoc;
}

function extractPrintStyles(printDoc: string): string {
  const m = printDoc.match(/<style>[\s\S]*?<\/style>/i);
  return m?.[0] ?? "";
}

type PackSlice = {
  slug: string;
  name: string;
  result: ReportExecutionResult | null;
  error?: string;
};

function TemplateReportRun({ slug }: { slug: string }) {
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const storeFacilities = useFacilityStore((s) => s.availableFacilities);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportExecutionResult | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [resultScope, setResultScope] = useState<{ facilityId: string | null; label: string } | null>(null);
  const [scopeFacilityId, setScopeFacilityId] = useState<string | null>(null);
  const [facilityOptions, setFacilityOptions] = useState<{ id: string; name: string }[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgWide, setOrgWide] = useState(false);

  const template = useMemo(() => PHASE1_TEMPLATE_SEED.find((item) => item.slug === slug), [slug]);

  const scopeLabel = useMemo(() => {
    if (scopeFacilityId === null) return "All facilities";
    return facilityOptions.find((f) => f.id === scopeFacilityId)?.name ?? "Selected facility";
  }, [scopeFacilityId, facilityOptions]);

  useEffect(() => {
    void (async () => {
      const ctx = await loadReportsRoleContext(supabase);
      if (ctx.ok) { setOrgId(ctx.ctx.organizationId); setOrgWide(["owner", "org_admin"].includes(ctx.ctx.appRole)); }
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
    } else {
      setScopeFacilityId(null);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    if (facilitiesLoading) return;
    if (!orgWide && scopeFacilityId === null && facilityOptions[0]) { setScopeFacilityId(facilityOptions[0].id); return; }
    if (
      scopeFacilityId !== null &&
      !facilityOptions.some((f) => f.id === scopeFacilityId)
    ) {
      setScopeFacilityId(null);
    }
  }, [facilitiesLoading, facilityOptions, scopeFacilityId, orgWide]);

  const onRun = useCallback(async () => {
    if (!orgId || (!orgWide && !scopeFacilityId)) return;
    setRunning(true);
    setError(null);
    try {
      const scopedFacilityId =
        scopeFacilityId !== null && isValidFacilityIdForQuery(scopeFacilityId)
          ? scopeFacilityId
          : null;

      const run = await runTemplateAndPersist({ supabase, organizationId: orgId, slug,
        title: template?.name ?? slug, facilityId: scopedFacilityId, scopeLabel });
      setResult(run.result);
      setLastRunId(run.runId);
      setResultScope({ facilityId: scopedFacilityId, label: run.snapshot.scopeLabel });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }, [orgId, orgWide, scopeFacilityId, scopeLabel, slug, supabase, template?.name]);

  const onExportCsv = useCallback(async () => {
    if (!result || !orgId || !lastRunId) return;
    const csv = `${summaryRowsToCsv([{metricKey:"Run",value:lastRunId},{metricKey:"Scope",value:resultScope?.label??scopeLabel}])}\n\n${buildFullCsv(result)}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const datePart = todayFacilityDateIso();
    anchor.href = url;
    anchor.download = `report-${slug}-${datePart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    await supabase.from("report_exports").insert({
      organization_id: orgId,
      report_run_id: lastRunId,
      export_format: "csv",
      file_name: `report-${slug}-${datePart}.csv`,
    });
  }, [lastRunId, orgId, result, resultScope, scopeLabel, slug, supabase]);

  const onPrint = useCallback(async () => {
    if (!result || !orgId || !lastRunId) return;
    const reportTitle = template?.name ?? slug;
    const html = buildReportPrintHtml({
      reportTitle,
      templateLabel: template?.name ?? slug,
      scopeLabel: resultScope?.label ?? scopeLabel,
      summary: result.summary,
      footnotes: result.footnotes,
    });
    const w = window.open("", "_blank");
    if (!w) {
      setError("Pop-up blocked. Allow pop-ups for this site to print or save as PDF.");
      return;
    }
    w.opener = null;
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
      file_name: `report-${slug}.pdf`,
    });
  }, [lastRunId, orgId, result, resultScope, scopeLabel, slug, supabase, template?.name]);

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <RecordDetailHeader
        title={`Run report: ${template?.name ?? slug}`}
        subtitle="Single template run"
        backLink={{ label: "Back to templates", href: "/admin/reports/templates" }}
      />

      {error ? (
        <p className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <RecordDetailSection
        title="Execution"
        description="Set scope and run now. Every run is recorded in report history."
      >
        <div className="space-y-6">
          <div className="grid max-w-lg gap-2">
            <Label htmlFor="report-facility-scope" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              Facility scope
            </Label>
            <p id="report-facility-scope-hint" className="text-xs leading-relaxed text-muted-foreground">
              Run for one site or across all facilities in your organization. When the header has a single facility selected,
              this scope starts aligned with it—you can switch to organization-wide anytime.
            </p>
            {orgWide ? <AdminFacilityScopeDropdown
              id="report-facility-scope"
              describedBy="report-facility-scope-hint"
              value={scopeFacilityId}
              onChange={setScopeFacilityId}
              facilities={facilityOptions}
              loading={facilitiesLoading}
              loadFailed={facilitiesLoadFailed}
              onRetry={() => void loadFacilityOptions()}
              disabled={running}
            /> : <select aria-label="Facility scope" className="rounded border bg-card p-3" value={scopeFacilityId ?? ""} onChange={event=>setScopeFacilityId(event.target.value || null)} disabled={running || facilitiesLoading}><option value="">Select a facility</option>{facilityOptions.map(facility=><option key={facility.id} value={facility.id}>{facility.name}</option>)}</select>}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void onRun()} disabled={running || !orgId}>
                {running ? "Running…" : "Run report"}
              </Button>
              <Button variant="secondary" onClick={() => void onExportCsv()} disabled={!result}>
                Download CSV
              </Button>
              <Button variant="outline" onClick={() => void onPrint()} disabled={!result}>
                Print / PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              CSV export filenames use today&apos;s Eastern (ET) calendar date.
            </p>
          </div>
        </div>
      </RecordDetailSection>

      {result ? (
        <RecordDetailSection title="Run result" description={`Scope: ${resultScope?.label ?? scopeLabel}${resultScope && resultScope.facilityId !== scopeFacilityId ? " · Scope changed; run again for the new selection." : ""}`}>
          <div className="space-y-6">
            <ReportRunResult summary={result.summary} detailRows={result.rows} />
            {result.footnotes && result.footnotes.length > 0 ? (
              <div className="rounded-[8px] border border-border bg-muted/40 p-[14px]">
                <p className="text-sm font-medium text-muted-foreground">Notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {result.footnotes.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </RecordDetailSection>
      ) : null}
    </div>
  );
}

function PackReportRun({ packId }: { packId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoRun = searchParams.get("autoRun") === "1";
  const ranAutoRef = useRef(false);

  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const storeFacilities = useFacilityStore((s) => s.availableFacilities);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [packName, setPackName] = useState<string>("Pack");
  const [loadingPack, setLoadingPack] = useState(true);
  const [slices, setSlices] = useState<PackSlice[]>([]);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [resultScope, setResultScope] = useState<{ facilityId: string | null; label: string } | null>(null);

  const [scopeFacilityId, setScopeFacilityId] = useState<string | null>(null);
  const [facilityOptions, setFacilityOptions] = useState<{ id: string; name: string }[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgWide, setOrgWide] = useState(false);

  const scopeLabel = useMemo(() => {
    if (scopeFacilityId === null) return "All facilities";
    return facilityOptions.find((f) => f.id === scopeFacilityId)?.name ?? "Selected facility";
  }, [scopeFacilityId, facilityOptions]);

  useEffect(() => {
    void (async () => {
      const ctx = await loadReportsRoleContext(supabase);
      if (ctx.ok) { setOrgId(ctx.ctx.organizationId); setOrgWide(["owner", "org_admin"].includes(ctx.ctx.appRole)); }
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
    } else {
      setScopeFacilityId(null);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    if (facilitiesLoading) return;
    if (!orgWide && scopeFacilityId === null && facilityOptions[0]) { setScopeFacilityId(facilityOptions[0].id); return; }
    if (
      scopeFacilityId !== null &&
      !facilityOptions.some((f) => f.id === scopeFacilityId)
    ) {
      setScopeFacilityId(null);
    }
  }, [facilitiesLoading, facilityOptions, scopeFacilityId, orgWide]);

  const loadPack = useCallback(async () => {
    if (!orgId) return;
    setLoadingPack(true);
    setError(null);
    try {
      const { data: packRow, error: packErr } = await supabase
        .from("report_packs")
        .select("name")
        .eq("id", packId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();
      if (packErr) throw new Error(packErr.message);
      if (!packRow) throw new Error("Pack not found.");
      setPackName(typeof packRow.name === "string" ? packRow.name : "Pack");

      const { data: items, error: itemsErr } = await supabase
        .from("report_pack_items")
        .select("source_id")
        .eq("pack_id", packId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("display_order", { ascending: true });
      if (itemsErr) throw new Error(itemsErr.message);
      const ids = (items ?? []).map((r) => (r as { source_id: string }).source_id).filter(Boolean);
      if (ids.length === 0) {
        setSlices([]);
        return;
      }

      const { data: tplRows, error: tplErr } = await supabase
        .from("report_templates")
        .select("id, slug, name")
        .in("id", ids)
        .eq("status", "active")
        .is("deleted_at", null);
      if (tplErr) throw new Error(tplErr.message);

      const meta = new Map((tplRows ?? []).map((t) => [t.id as string, t as { slug: string; name: string }]));
      const ordered: PackSlice[] = [];
      for (const tid of ids) {
        const row = meta.get(tid);
        if (row) ordered.push({ slug: row.slug, name: row.name, result: null });
      }
      setSlices(ordered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pack.");
      setSlices([]);
    } finally {
      setLoadingPack(false);
    }
  }, [orgId, packId, supabase]);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  const runPack = useCallback(
    async (opts?: { stripQueryAfter?: boolean }) => {
    if (!orgId || slices.length === 0 || (!orgWide && !scopeFacilityId)) return;
    setRunning(true);
    setError(null);
    let createdRunId: string | null = null;
    try {
      const scopedFacilityId =
        scopeFacilityId !== null && isValidFacilityIdForQuery(scopeFacilityId)
          ? scopeFacilityId
          : null;

      const { data: runRow, error: runErr } = await supabase
        .from("report_runs")
        .insert({
          organization_id: orgId,
          source_type: "pack",
          source_id: packId,
          template_id: null,
          status: "running",
          run_scope_json: scopedFacilityId ? { facility_id: scopedFacilityId } : {},
        })
        .select("id")
        .single();
      if (runErr) throw new Error(runErr.message);
      setLastRunId(runRow.id);
      createdRunId = runRow.id;
      setResultScope({ facilityId: scopedFacilityId, label: scopeLabel });

      const nextSlices: PackSlice[] = [...slices.map((s) => ({ ...s, result: null, error: undefined }))];
      setSlices(nextSlices);

      for (let i = 0; i < nextSlices.length; i += 1) {
        const slug = nextSlices[i].slug;
        try {
          const execution = await executeReportTemplate(slug, {
            supabase,
            organizationId: orgId,
            facilityId: scopedFacilityId,
          });
          nextSlices[i] = { ...nextSlices[i], result: execution };
        } catch (e) {
          nextSlices[i] = {
            ...nextSlices[i],
            result: null,
            error: e instanceof Error ? e.message : "Report failed.",
          };
        }
        setSlices([...nextSlices]);
      }

      await finishReportRun(supabase, orgId, runRow.id, {
        title: packName, scopeLabel, facilityId: scopedFacilityId, generatedAt: new Date().toISOString(), slices: nextSlices,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Pack run failed.";
      if (createdRunId) {
        try { await failReportRun(supabase, orgId, createdRunId, message); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : message); return; }
      }
      setError(message);
    } finally {
      setRunning(false);
      if (opts?.stripQueryAfter) {
        router.replace(`/admin/reports/run/pack/${packId}`, { scroll: false });
      }
    }
  },
    [orgId, orgWide, packId, packName, router, scopeFacilityId, scopeLabel, slices, supabase],
  );

  useEffect(() => {
    if (!autoRun || loadingPack || slices.length === 0 || ranAutoRef.current) return;
    ranAutoRef.current = true;
    void runPack({ stripQueryAfter: true });
  }, [autoRun, loadingPack, runPack, slices.length]);

  const completedSlices = slices.filter((s) => s.result);

  const onExportCsvPack = useCallback(async () => {
    if (!orgId || !lastRunId || completedSlices.length === 0) return;
    const bodies = completedSlices.map((s) => `--- ${s.name} (${s.slug}) ---\n${buildFullCsv(s.result!)}`);
    const csv = `${summaryRowsToCsv([{metricKey:"Run",value:lastRunId},{metricKey:"Scope",value:resultScope?.label??scopeLabel}])}\n\n${bodies.join("\n\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const datePart = todayFacilityDateIso();
    anchor.href = url;
    anchor.download = `pack-${packId}-${datePart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    await supabase.from("report_exports").insert({
      organization_id: orgId,
      report_run_id: lastRunId,
      export_format: "csv",
      file_name: `pack-${packId}-${datePart}.csv`,
    });
  }, [completedSlices, lastRunId, orgId, packId, resultScope, scopeLabel, supabase]);

  const onPrintPack = useCallback(async () => {
    if (!orgId || !lastRunId || completedSlices.length === 0) return;
    const docs = completedSlices.map((s) =>
      buildReportPrintHtml({
        reportTitle: `${packName} · ${s.name}`,
        templateLabel: s.name,
        scopeLabel: resultScope?.label ?? scopeLabel,
        summary: s.result!.summary,
        footnotes: s.result!.footnotes,
      }),
    );
    const styles = extractPrintStyles(docs[0] ?? "");
    const sheets = docs.map((d) => extractSheetHtml(d));
    const combined = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(packName)}</title>${styles}</head><body>${sheets.join('<div style="page-break-before:always;height:1px"></div>')}</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      setError("Pop-up blocked. Allow pop-ups for this site to print or save as PDF.");
      return;
    }
    w.opener = null;
    w.document.write(combined);
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
      file_name: `pack-${packId}.pdf`,
    });
  }, [completedSlices, lastRunId, orgId, packId, packName, resultScope, scopeLabel, supabase]);

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <RecordDetailHeader
        title={`Run pack: ${packName}`}
        subtitle="Runs each template in this pack sequentially for the selected scope."
        backLink={{ label: "Back to packs", href: "/admin/reports/packs" }}
      />

      {error ? (
        <p className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <RecordDetailSection
        title="Execution"
        description="Pack runs execute multiple templates in order. Large packs may take longer."
      >
        <div className="space-y-6">
          <div className="grid max-w-lg gap-2">
            <Label htmlFor="pack-facility-scope" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              Facility scope
            </Label>
            <p id="pack-facility-scope-hint" className="text-xs leading-relaxed text-muted-foreground">
              Applies to every report in this pack for this run.
            </p>
            {orgWide ? <AdminFacilityScopeDropdown
              id="pack-facility-scope"
              describedBy="pack-facility-scope-hint"
              value={scopeFacilityId}
              onChange={setScopeFacilityId}
              facilities={facilityOptions}
              loading={facilitiesLoading}
              loadFailed={facilitiesLoadFailed}
              onRetry={() => void loadFacilityOptions()}
              disabled={running}
            /> : <select aria-label="Facility scope" className="rounded border bg-card p-3" value={scopeFacilityId ?? ""} onChange={event=>setScopeFacilityId(event.target.value || null)} disabled={running || facilitiesLoading}><option value="">Select a facility</option>{facilityOptions.map(facility=><option key={facility.id} value={facility.id}>{facility.name}</option>)}</select>}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void runPack()} disabled={running || !orgId || loadingPack || slices.length === 0}>
                {running ? "Running pack…" : "Run pack"}
              </Button>
              <Button variant="secondary" onClick={() => void onExportCsvPack()} disabled={completedSlices.length === 0}>
                Download CSV
              </Button>
              <Button variant="outline" onClick={() => void onPrintPack()} disabled={completedSlices.length === 0}>
                Print / PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              CSV export filenames use today&apos;s Eastern (ET) calendar date.
            </p>
          </div>
          {loadingPack ? <p className="text-sm text-muted-foreground">Loading pack…</p> : null}
          {!loadingPack && slices.length === 0 ? (
            <p className="text-sm text-muted-foreground">This pack has no templates configured.</p>
          ) : null}
        </div>
      </RecordDetailSection>

      {slices.some((s) => s.result || s.error) ? (
        <RecordDetailSection title="Run results" description={`Scope: ${resultScope?.label ?? scopeLabel}${resultScope && resultScope.facilityId !== scopeFacilityId ? " · Scope changed; run again for the new selection." : ""}`}>
          <div className="space-y-10">
            {slices.map((s) =>
              s.error ? (
                <div key={s.slug} className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <p className="font-medium text-destructive">{s.name}</p>
                  <p className="mt-1 text-sm text-destructive/90">{s.error}</p>
                </div>
              ) : s.result ? (
                <div key={s.slug} className="space-y-4">
                  <p className="text-base font-semibold text-foreground">{s.name}</p>
                  <ReportRunResult summary={s.result.summary} detailRows={s.result.rows} />
                </div>
              ) : null,
            )}
          </div>
        </RecordDetailSection>
      ) : null}
    </div>
  );
}

export default function ReportRunPage() {
  const params = useParams<{ sourceType: string; id: string }>();
  const sourceType = params.sourceType ?? "template";
  const sourceId = params.id ?? "";

  if (sourceType === "pack") {
    if (!PACK_UUID_RE.test(sourceId)) {
      return (
        <div className="space-y-6 px-4 py-8">
          <ReportsHubNav />
          <p className="text-sm text-destructive">Invalid pack reference.</p>
          <Link
            href="/admin/reports/packs"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Back to packs
          </Link>
        </div>
      );
    }
    return <PackReportRun key={sourceId} packId={sourceId} />;
  }

  return <TemplateReportRun key={sourceId} slug={sourceId} />;
}
