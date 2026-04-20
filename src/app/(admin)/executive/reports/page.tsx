"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { FileSpreadsheet, Sparkles } from "lucide-react";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  fetchStandupSnapshotDetail,
} from "@/lib/executive/standup";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/types/database";

type ReportRow = Database["public"]["Tables"]["exec_saved_reports"]["Row"];
type ExecTemplate = Database["public"]["Enums"]["exec_report_template"];

const TEMPLATE_LABELS: Record<ExecTemplate, string> = {
  ops_weekly: "Ops weekly",
  financial_monthly: "Financial monthly",
  board_quarterly: "Board quarterly",
  custom: "Custom",
};

function parseReportParameters(raw: Json): {
  facilityId: string | null;
  kind: string | null;
  weekOf: string | null;
  status: string | null;
  confidenceBand: string | null;
  version: number | null;
  publishedAt: string | null;
  completenessPct: number | null;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      facilityId: null,
      kind: null,
      weekOf: null,
      status: null,
      confidenceBand: null,
      version: null,
      publishedAt: null,
      completenessPct: null,
    };
  }
  const o = raw as Record<string, unknown>;
  const fid = o.facilityId;
  const kind = typeof o.kind === "string" && o.kind.length > 0 ? o.kind : null;
  const weekOf = typeof o.weekOf === "string" && o.weekOf.length > 0 ? o.weekOf : null;
  const status = typeof o.status === "string" && o.status.length > 0 ? o.status : null;
  const confidenceBand = typeof o.confidenceBand === "string" && o.confidenceBand.length > 0 ? o.confidenceBand : null;
  const version = typeof o.version === "number" ? o.version : null;
  const publishedAt = typeof o.publishedAt === "string" && o.publishedAt.length > 0 ? o.publishedAt : null;
  const completenessPct = typeof o.completenessPct === "number" ? o.completenessPct : null;
  if (typeof fid === "string" && fid.length > 0) return { facilityId: fid, kind, weekOf, status, confidenceBand, version, publishedAt, completenessPct };
  return { facilityId: null, kind, weekOf, status, confidenceBand, version, publishedAt, completenessPct };
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function kpiToCsv(reportName: string, kpi: ExecKpiPayload): string {
  const generatedAt = new Date().toISOString();
  const lines: string[][] = [
    ["report", reportName],
    ["generated_at", generatedAt],
    ["metric", "value"],
    ["census.occupied_residents", String(kpi.census.occupiedResidents)],
    ["census.licensed_beds", String(kpi.census.licensedBeds)],
    ["census.occupancy_pct", kpi.census.occupancyPct == null ? "" : String(kpi.census.occupancyPct)],
    ["financial.open_invoices", String(kpi.financial.openInvoicesCount)],
    ["financial.total_balance_due_cents", String(kpi.financial.totalBalanceDueCents)],
    ["clinical.open_incidents", String(kpi.clinical.openIncidents)],
    ["clinical.medication_errors_mtd", String(kpi.clinical.medicationErrorsMtd)],
    ["compliance.open_survey_deficiencies", String(kpi.compliance.openSurveyDeficiencies)],
    ["workforce.certifications_expiring_30d", String(kpi.workforce.certificationsExpiring30d)],
    ["infection.active_outbreaks", String(kpi.infection.activeOutbreaks)],
  ];
  return lines.map((row) => row.map((c) => escapeCsvCell(c)).join(",")).join("\n");
}

function downloadTextFile(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExecutiveKpiPrintHtml(props: {
  reportName: string;
  templateLabel: string;
  scopeLabel: string;
  kpi: ExecKpiPayload;
}): string {
  const { reportName, templateLabel, scopeLabel, kpi } = props;
  const generatedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const rows: { label: string; value: string }[] = [
    { label: "Occupied residents", value: String(kpi.census.occupiedResidents) },
    { label: "Licensed beds", value: String(kpi.census.licensedBeds) },
    {
      label: "Occupancy %",
      value: kpi.census.occupancyPct == null ? "—" : String(kpi.census.occupancyPct),
    },
    { label: "Open invoices", value: String(kpi.financial.openInvoicesCount) },
    {
      label: "Total balance due",
      value: money.format(kpi.financial.totalBalanceDueCents / 100),
    },
    { label: "Open incidents", value: String(kpi.clinical.openIncidents) },
    { label: "Medication errors (MTD)", value: String(kpi.clinical.medicationErrorsMtd) },
    { label: "Open survey deficiencies", value: String(kpi.compliance.openSurveyDeficiencies) },
    { label: "Certs expiring (30d)", value: String(kpi.workforce.certificationsExpiring30d) },
    { label: "Active outbreaks", value: String(kpi.infection.activeOutbreaks) },
  ];
  const bodyRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(reportName)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 24px; color: #111; max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  .meta { font-size: 0.875rem; color: #444; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th { background: #f4f4f5; font-weight: 600; }
  .foot { margin-top: 16px; font-size: 0.75rem; color: #666; }
  @media print { body { padding: 12px; } }
</style></head><body>
<h1>${escapeHtml(reportName)}</h1>
<div class="meta">Template: ${escapeHtml(templateLabel)} · Scope: ${escapeHtml(scopeLabel)} · Generated: ${escapeHtml(generatedAt)}</div>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${bodyRows}</tbody></table>
<p class="foot">Haven — Executive KPI snapshot (live aggregates). Use your browser &ldquo;Print&rdquo; dialog and choose &ldquo;Save as PDF&rdquo; if available.</p>
</body></html>`;
}

function isStandupBoardPacketReport(report: ReportRow): boolean {
  return parseReportParameters(report.parameters).kind === "executive_standup_board_packet";
}

export default function ExecutiveSavedReportsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<ExecTemplate>("custom");
  const [newFacilityId, setNewFacilityId] = useState<string>("");
  const standupPacketRows = rows.filter(isStandupBoardPacketReport);
  const otherRows = rows.filter((row) => !isStandupBoardPacketReport(row));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        setCanManage(false);
        setOrgId(null);
        return;
      }
      setOrgId(ctx.ctx.organizationId);
      const manage = canMutateFinance(ctx.ctx.appRole);
      setCanManage(manage);

      if (!manage) {
        setRows([]);
        setFacilities([]);
        return;
      }

      const [{ data: reports, error: rErr }, { data: facs, error: fErr }] = await Promise.all([
        supabase
          .from("exec_saved_reports")
          .select("*")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false }),
        supabase
          .from("facilities")
          .select("id, name")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("name"),
      ]);

      if (rErr) throw new Error(rErr.message);
      if (fErr) throw new Error(fErr.message);
      setRows((reports ?? []) as ReportRow[]);
      setFacilities((facs ?? []).map((f) => ({ id: f.id, name: f.name })));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Unable to load saved reports.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !orgId) return;
    const name = newName.trim();
    if (!name) {
      setError("Enter a report name.");
      return;
    }
    setBusyId("__create__");
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in required.");
        return;
      }
      const facilityId = newFacilityId || null;
      const parameters: Json = facilityId ? { facilityId } : {};
      const { error: insErr } = await supabase.from("exec_saved_reports").insert({
        organization_id: orgId,
        created_by: user.id,
        name,
        template: newTemplate,
        parameters,
      });
      if (insErr) throw new Error(insErr.message);
      setNewName("");
      setNewTemplate("custom");
      setNewFacilityId("");
      setCreateOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function persistLastGenerated(reportId: string) {
    if (!orgId) return;
    const { error: upErr } = await supabase
      .from("exec_saved_reports")
      .update({ last_generated_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("organization_id", orgId);
    if (upErr) throw new Error(upErr.message);
    await load();
  }

  function scopeLabelFor(report: ReportRow): string {
    const { facilityId, kind, weekOf } = parseReportParameters(report.parameters);
    if (kind === "executive_standup_board_packet" && weekOf) return `Week of ${weekOf}`;
    if (!facilityId) return "Organization";
    return facilities.find((f) => f.id === facilityId)?.name ?? "Facility";
  }

  async function buildStandupPacketHtml(report: ReportRow): Promise<string> {
    if (!orgId) throw new Error("Organization scope is required.");
    const { weekOf } = parseReportParameters(report.parameters);
    if (!weekOf) throw new Error("Standup week is missing from the saved report.");
    const [detail, previous] = await Promise.all([
      fetchStandupSnapshotDetail(supabase, orgId, weekOf),
      fetchPreviousPublishedStandupSnapshotDetail(supabase, orgId, weekOf),
    ]);
    if (!detail) throw new Error(`No standup snapshot found for week ${weekOf}.`);
    return buildStandupBoardPrintHtml(detail, previous);
  }

  async function onGenerateCsv(report: ReportRow) {
    if (!canManage || !orgId) return;
    if (isStandupBoardPacketReport(report)) {
      setError("Standup board packets export as board HTML or Print/PDF, not CSV.");
      return;
    }
    setBusyId(report.id);
    setError(null);
    try {
      const { facilityId } = parseReportParameters(report.parameters);
      const kpi = await fetchExecutiveKpiSnapshot(supabase, orgId, facilityId);
      const csv = kpiToCsv(report.name, kpi);
      const safe = report.name.replace(/[^\w\-]+/g, "_").slice(0, 48);
      downloadTextFile(`haven-exec-${safe}-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
      await persistLastGenerated(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function onPrintPdf(report: ReportRow) {
    if (!canManage || !orgId) return;
    setBusyId(report.id);
    setError(null);
    try {
      if (isStandupBoardPacketReport(report)) {
        const html = await buildStandupPacketHtml(report);
        const w = window.open("", "_blank", "noopener,noreferrer");
        if (!w) {
          setError("Pop-up blocked. Allow pop-ups for this site to print or save as PDF.");
          return;
        }
        w.document.write(html);
        w.document.close();
        w.focus();
        const trigger = () => { try { w.print(); } catch { /* ignore */ } };
        if (w.document.readyState === "complete") {
          setTimeout(trigger, 0);
        } else {
          const onLoad = () => { setTimeout(trigger, 0); w.removeEventListener("load", onLoad); };
          w.addEventListener("load", onLoad);
        }
        await persistLastGenerated(report.id);
        return;
      }

      const { facilityId } = parseReportParameters(report.parameters);
      const kpi = await fetchExecutiveKpiSnapshot(supabase, orgId, facilityId);
      const html = buildExecutiveKpiPrintHtml({
        reportName: report.name,
        templateLabel: TEMPLATE_LABELS[report.template],
        scopeLabel: scopeLabelFor(report),
        kpi,
      });
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) {
        setError("Pop-up blocked. Allow pop-ups for this site to print or save as PDF.");
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      const trigger = () => { try { w.print(); } catch { /* ignore */ } };
      if (w.document.readyState === "complete") {
        setTimeout(trigger, 0);
      } else {
        const onLoad = () => { setTimeout(trigger, 0); w.removeEventListener("load", onLoad); };
        w.addEventListener("load", onLoad);
      }
      await persistLastGenerated(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function onOpenBoardPacket(report: ReportRow) {
    if (!canManage) return;
    setBusyId(report.id);
    setError(null);
    try {
      const { weekOf } = parseReportParameters(report.parameters);
      if (!weekOf) {
        setError("Saved packet is missing its standup week.");
        return;
      }
      window.open(`/admin/executive/standup/${weekOf}/board`, "_blank", "noopener,noreferrer");
      await persistLastGenerated(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open board packet.");
    } finally {
      setBusyId(null);
    }
  }

  async function onEnhancedReport(report: ReportRow) {
    if (!canManage || !orgId) return;
    setBusyId(report.id);
    setError(null);
    try {
      if (isStandupBoardPacketReport(report)) {
        await onOpenBoardPacket(report);
        return;
      }
      const { facilityId } = parseReportParameters(report.parameters);
      const res = await authorizedEdgeFetch("exec-report-generator", {
        method: "POST",
        body: JSON.stringify({
          template: report.template,
          facility_id: facilityId,
        }),
      }, "exec-report-gen");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Report generation failed");
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) { setError("Pop-up blocked."); return; }
      w.document.write(data.html);
      w.document.close();
      w.focus();
      const trigger = () => { try { w.print(); } catch { /* ignore */ } };
      if (w.document.readyState === "complete") setTimeout(trigger, 0);
      else { const h = () => { setTimeout(trigger, 0); w.removeEventListener("load", h); }; w.addEventListener("load", h); }
      await persistLastGenerated(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enhanced report failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(report: ReportRow) {
    if (!canManage || !orgId) return;
    if (!window.confirm(`Remove saved report “${report.name}”?`)) return;
    setBusyId(report.id);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from("exec_saved_reports")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", report.id)
        .eq("organization_id", orgId);
      if (delErr) throw new Error(delErr.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Saved reports</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Named report definitions; export CSV or open a printable report (save as PDF from the browser).
            </p>
          </div>
        </div>
        {canManage && (
          <Button type="button" variant={createOpen ? "secondary" : "default"} onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? "Cancel" : "New report"}
          </Button>
        )}
      </div>

      <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
        Reporting has moved to the dedicated module. Use{" "}
        <Link href="/admin/reports" className="underline underline-offset-2">
          /admin/reports
        </Link>{" "}
        for template library, scheduling, packs, and audit history.
      </p>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!canManage && !loading && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
          Saved executive reports are managed by organization administrators.
        </p>
      )}

      {canManage && createOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create saved report</CardTitle>
            <CardDescription>
              Template labels help your team choose the right cadence; exports use current live KPIs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="grid max-w-lg gap-4">
              <div className="space-y-2">
                <Label htmlFor="exec-report-name">Name</Label>
                <Input
                  id="exec-report-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Weekly ops — North region"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exec-report-template">Template</Label>
                <select
                  id="exec-report-template"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value as ExecTemplate)}
                >
                  {(Object.keys(TEMPLATE_LABELS) as ExecTemplate[]).map((t) => (
                    <option key={t} value={t}>
                      {TEMPLATE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exec-report-facility">Scope</Label>
                <select
                  id="exec-report-facility"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={newFacilityId}
                  onChange={(e) => setNewFacilityId(e.target.value)}
                >
                  <option value="">All facilities (organization)</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={busyId === "__create__"}>
                {busyId === "__create__" ? "Saving…" : "Save report"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {canManage && !loading && (
        <>
        {standupPacketRows.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Standup packet archive</CardTitle>
              <CardDescription>
                Weekly board packets saved from the Executive Standup workflow. These entries preserve week, version, confidence, and publish context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Packet metadata</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>Last opened</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standupPacketRows.map((r) => {
                    const parsed = parseReportParameters(r.parameters);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{parsed.weekOf ?? r.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {parsed.version != null ? <Badge variant="outline">v{parsed.version}</Badge> : null}
                            {parsed.confidenceBand ? <Badge variant="outline">{parsed.confidenceBand} confidence</Badge> : null}
                            {parsed.status ? <Badge variant="outline">{parsed.status}</Badge> : null}
                            {parsed.completenessPct != null ? <Badge variant="outline">{parsed.completenessPct.toFixed(0)}% complete</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {parsed.publishedAt ? new Date(parsed.publishedAt).toLocaleString() : "Not yet"}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.last_generated_at ? new Date(r.last_generated_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busyId !== null}
                              onClick={() => void onOpenBoardPacket(r)}
                            >
                              {busyId === r.id ? "Working…" : "Open packet"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyId !== null}
                              onClick={() => void onPrintPdf(r)}
                            >
                              {busyId === r.id ? "Working…" : "Print / PDF"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busyId !== null}
                              onClick={() => void onDelete(r)}
                            >
                              Remove
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your reports</CardTitle>
            <CardDescription>
              Download CSV for spreadsheets, or print / save as PDF for board packs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {otherRows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No saved reports yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Last generated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherRows.map((r) => {
                    const scopeLabel = scopeLabelFor(r);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{TEMPLATE_LABELS[r.template]}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">{scopeLabel}</TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.last_generated_at ? new Date(r.last_generated_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busyId !== null}
                              onClick={() => void onGenerateCsv(r)}
                            >
                              {busyId === r.id ? "Working…" : "Download CSV"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyId !== null}
                              onClick={() => void onPrintPdf(r)}
                            >
                              {busyId === r.id ? "Working…" : "Print / PDF"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyId !== null}
                              onClick={() => void onEnhancedReport(r)}
                              className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                            >
                              <Sparkles className="mr-1 h-3 w-3" />
                              {busyId === r.id ? "Working…" : "Enhanced"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busyId !== null}
                              onClick={() => void onDelete(r)}
                            >
                              Remove
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
