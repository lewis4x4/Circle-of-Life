"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet } from "lucide-react";

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

function parseReportParameters(raw: Json): { facilityId: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { facilityId: null };
  const o = raw as Record<string, unknown>;
  const fid = o.facilityId;
  if (typeof fid === "string" && fid.length > 0) return { facilityId: fid };
  return { facilityId: null };
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

  async function onCreate(e: React.FormEvent) {
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

  async function onGenerateCsv(report: ReportRow) {
    if (!canManage || !orgId) return;
    setBusyId(report.id);
    setError(null);
    try {
      const { facilityId } = parseReportParameters(report.parameters);
      const kpi = await fetchExecutiveKpiSnapshot(supabase, orgId, facilityId);
      const csv = kpiToCsv(report.name, kpi);
      const safe = report.name.replace(/[^\w\-]+/g, "_").slice(0, 48);
      downloadTextFile(`haven-exec-${safe}-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");

      const { error: upErr } = await supabase
        .from("exec_saved_reports")
        .update({ last_generated_at: new Date().toISOString() })
        .eq("id", report.id)
        .eq("organization_id", orgId);
      if (upErr) throw new Error(upErr.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
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
              Named report definitions; generate a CSV snapshot from live executive KPIs for the selected scope.
            </p>
          </div>
        </div>
        {canManage && (
          <Button type="button" variant={createOpen ? "secondary" : "default"} onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? "Cancel" : "New report"}
          </Button>
        )}
      </div>

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
              Template labels help your team choose the right cadence; CSV export always uses current live KPIs.
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
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your reports</CardTitle>
            <CardDescription>
              Download CSV for board packs or offline review. PDF exports can follow in an enhanced slice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
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
                  {rows.map((r) => {
                    const { facilityId } = parseReportParameters(r.parameters);
                    const scopeLabel = facilityId
                      ? facilities.find((f) => f.id === facilityId)?.name ?? "Facility"
                      : "Organization";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{TEMPLATE_LABELS[r.template]}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">{scopeLabel}</TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.last_generated_at
                            ? new Date(r.last_generated_at).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
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
      )}
    </div>
  );
}
