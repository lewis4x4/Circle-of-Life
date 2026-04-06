"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BarChart3 } from "lucide-react";

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
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CohortRow = Database["public"]["Tables"]["benchmark_cohorts"]["Row"];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function pctBarWidth(value: number, max: number): number {
  if (max <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function CohortBarRow({
  label,
  display,
  widthPct,
}: {
  label: string;
  display: string;
  widthPct: number;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-36 shrink-0 truncate font-medium sm:w-44" title={label}>
        {label}
      </span>
      <div className="h-2.5 min-w-[72px] flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-2.5 rounded-full bg-primary/90 transition-[width] duration-300"
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-400">{display}</span>
    </div>
  );
}

export default function ExecutiveBenchmarkCohortsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CohortRow[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formMinimumN, setFormMinimumN] = useState(5);
  const [formFacilityIds, setFormFacilityIds] = useState<Set<string>>(new Set());

  const [compareCohortId, setCompareCohortId] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<{
    cohort: CohortRow;
    orgKpi: ExecKpiPayload;
    facilities: { id: string; name: string; kpi: ExecKpiPayload }[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        setFacilities([]);
        setCanManage(false);
        setOrgId(null);
        return;
      }
      setOrgId(ctx.ctx.organizationId);
      setCanManage(canMutateFinance(ctx.ctx.appRole));

      const [{ data: facs, error: fErr }, { data: cohorts, error: cErr }] = await Promise.all([
        supabase
          .from("facilities")
          .select("id, name")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("benchmark_cohorts")
          .select("*")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("name"),
      ]);

      if (fErr) throw new Error(fErr.message);
      if (cErr) throw new Error(cErr.message);
      setFacilities((facs ?? []).map((f) => ({ id: f.id, name: f.name })));
      setRows((cohorts ?? []) as CohortRow[]);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Unable to load benchmark cohorts.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormMinimumN(5);
    setFormFacilityIds(new Set());
    setEditingId(null);
  }

  function startEdit(row: CohortRow) {
    setEditingId(row.id);
    setFormName(row.name);
    setFormDescription(row.description ?? "");
    setFormMinimumN(row.minimum_n);
    setFormFacilityIds(new Set(row.facility_ids ?? []));
    setCreateOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !orgId) return;
    const name = formName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    const minN = Math.max(5, Math.min(9999, Math.floor(formMinimumN) || 5));
    const facility_ids = [...formFacilityIds];

    setBusyId(editingId ?? "__new__");
    setError(null);
    try {
      if (editingId) {
        const { error: uErr } = await supabase
          .from("benchmark_cohorts")
          .update({
            name,
            description: formDescription.trim() || null,
            minimum_n: minN,
            facility_ids,
          })
          .eq("id", editingId)
          .eq("organization_id", orgId);
        if (uErr) throw new Error(uErr.message);
      } else {
        const { error: iErr } = await supabase.from("benchmark_cohorts").insert({
          organization_id: orgId,
          name,
          description: formDescription.trim() || null,
          minimum_n: minN,
          facility_ids,
        });
        if (iErr) throw new Error(iErr.message);
      }
      resetForm();
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(row: CohortRow) {
    if (!canManage || !orgId) return;
    if (!window.confirm(`Remove benchmark cohort “${row.name}”?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const { error: dErr } = await supabase
        .from("benchmark_cohorts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", orgId);
      if (dErr) throw new Error(dErr.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleFacility(id: string) {
    setFormFacilityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runCohortComparison() {
    if (!orgId || !compareCohortId) return;
    const cohort = rows.find((r) => r.id === compareCohortId);
    if (!cohort?.facility_ids?.length) {
      setCompareError("Choose a cohort that includes at least one facility.");
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    try {
      const orgKpi = await fetchExecutiveKpiSnapshot(supabase, orgId, null);
      const facResults = await Promise.all(
        cohort.facility_ids.map(async (fid) => {
          const kpi = await fetchExecutiveKpiSnapshot(supabase, orgId, fid);
          const name = facilities.find((f) => f.id === fid)?.name ?? fid.slice(0, 8);
          return { id: fid, name, kpi };
        }),
      );
      setCompareData({ cohort, orgKpi, facilities: facResults });
    } catch (e) {
      setCompareData(null);
      setCompareError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setCompareLoading(false);
    }
  }

  const facNameById = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Benchmark cohorts</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Define peer groups of facilities for future KPI comparisons. Minimum cohort size must be at least 5 sites
              before peer benchmarks can be surfaced (privacy).
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            type="button"
            variant={createOpen ? "secondary" : "default"}
            onClick={() => {
              if (createOpen) {
                setCreateOpen(false);
                resetForm();
              } else {
                resetForm();
                setCreateOpen(true);
              }
            }}
          >
            {createOpen ? "Cancel" : "New cohort"}
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
          Benchmark cohorts are managed by organization administrators.
        </p>
      )}

      {canManage && createOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? "Edit cohort" : "Create cohort"}</CardTitle>
            <CardDescription>
              Select which facilities belong to this peer group. Empty selection means the cohort is not yet scoped to
              specific sites.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
              <div className="space-y-2">
                <Label htmlFor="cohort-name">Name</Label>
                <Input
                  id="cohort-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. North Florida AL peer set"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cohort-desc">Description (optional)</Label>
                <textarea
                  id="cohort-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className={cn(
                    "flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
                    "placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
                    "dark:border-slate-800 dark:bg-slate-950",
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cohort-min-n">Minimum N (≥ 5)</Label>
                <Input
                  id="cohort-min-n"
                  type="number"
                  min={5}
                  max={9999}
                  value={formMinimumN}
                  onChange={(e) => setFormMinimumN(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium leading-none">Facilities</span>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  {facilities.length === 0 ? (
                    <p className="text-sm text-slate-500">No facilities in this organization.</p>
                  ) : (
                    facilities.map((f) => (
                      <label key={f.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300"
                          checked={formFacilityIds.has(f.id)}
                          onChange={() => toggleFacility(f.id)}
                        />
                        {f.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
              <Button type="submit" disabled={busyId !== null}>
                {busyId && (busyId === editingId || busyId === "__new__") ? "Saving…" : "Save cohort"}
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

      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cohort definitions</CardTitle>
            <CardDescription>
              Peer groups below; use the comparison table to view live KPIs side by side for each site in a cohort.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No benchmark cohorts yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Min N</TableHead>
                    <TableHead>Facilities</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const labels = (r.facility_ids ?? [])
                      .map((id) => facNameById[id] ?? id.slice(0, 8))
                      .join(", ");
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.description ? (
                            <span className="mt-1 block text-xs font-normal text-slate-500">{r.description}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.minimum_n}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-slate-600 dark:text-slate-400">
                          {(r.facility_ids?.length ?? 0) === 0
                            ? "—"
                            : labels || `${r.facility_ids?.length} selected`}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={busyId !== null}
                                onClick={() => startEdit(r)}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                disabled={busyId !== null}
                                onClick={() => void onRemove(r)}
                              >
                                Remove
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">View only</span>
                          )}
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

      {!loading && rows.length > 0 && orgId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Peer comparison (live KPIs)</CardTitle>
            <CardDescription>
              Portfolio row uses all facilities; cohort rows use the same live aggregates as the executive command
              center. Peer benchmarks require at least <strong>minimum N</strong> sites in the cohort (privacy).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="compare-cohort">Cohort</Label>
                <select
                  id="compare-cohort"
                  className="flex h-10 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={compareCohortId}
                  onChange={(e) => {
                    setCompareCohortId(e.target.value);
                    setCompareData(null);
                    setCompareError(null);
                  }}
                >
                  <option value="">Select cohort…</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                disabled={!compareCohortId || compareLoading}
                onClick={() => void runCohortComparison()}
              >
                {compareLoading ? "Loading…" : "Compare KPIs"}
              </Button>
            </div>
            {compareError && (
              <p className="text-sm text-destructive">{compareError}</p>
            )}
            {compareData && (
              <div className="space-y-3">
                {compareData.cohort.facility_ids.length < compareData.cohort.minimum_n && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    This cohort has fewer than <strong>{compareData.cohort.minimum_n}</strong> facilities — peer
                    benchmarks are not statistically surfaced; table is for operational review only.
                  </p>
                )}
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scope</TableHead>
                        <TableHead className="text-right">Occ. %</TableHead>
                        <TableHead className="text-right">Residents / beds</TableHead>
                        <TableHead className="text-right">AR balance</TableHead>
                        <TableHead className="text-right">Open inc.</TableHead>
                        <TableHead className="text-right">Deficiencies</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableCell className="font-medium">Organization (portfolio)</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compareData.orgKpi.census.occupancyPct ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compareData.orgKpi.census.occupiedResidents} / {compareData.orgKpi.census.licensedBeds}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money.format(compareData.orgKpi.financial.totalBalanceDueCents / 100)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compareData.orgKpi.clinical.openIncidents}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compareData.orgKpi.compliance.openSurveyDeficiencies}
                        </TableCell>
                      </TableRow>
                      {compareData.facilities.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="font-medium">{f.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {f.kpi.census.occupancyPct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {f.kpi.census.occupiedResidents} / {f.kpi.census.licensedBeds}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money.format(f.kpi.financial.totalBalanceDueCents / 100)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{f.kpi.clinical.openIncidents}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {f.kpi.compliance.openSurveyDeficiencies}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {(() => {
                  const series = [
                    { label: "Organization (portfolio)", kpi: compareData.orgKpi },
                    ...compareData.facilities.map((f) => ({ label: f.name, kpi: f.kpi })),
                  ];
                  const maxInc = Math.max(
                    ...series.map((s) => s.kpi.clinical.openIncidents),
                    1,
                  );
                  const maxDef = Math.max(
                    ...series.map((s) => s.kpi.compliance.openSurveyDeficiencies),
                    1,
                  );
                  const maxAr = Math.max(
                    ...series.map((s) => s.kpi.financial.totalBalanceDueCents),
                    1,
                  );
                  return (
                    <div className="space-y-6 rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          Visual comparison (CSS bars)
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Occupancy uses 0–100%. Incidents, deficiencies, and AR scale to the highest value in this
                          cohort plus portfolio row (operational view, not statistical inference).
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Occupancy</p>
                        <div className="space-y-1.5">
                          {series.map((s, idx) => {
                            const occ = s.kpi.census.occupancyPct;
                            const w =
                              occ != null && Number.isFinite(occ)
                                ? pctBarWidth(Math.min(100, Math.max(0, occ)), 100)
                                : 0;
                            return (
                              <CohortBarRow
                                key={`occ-${idx}`}
                                label={s.label}
                                display={
                                  occ != null && Number.isFinite(occ) ? `${occ.toFixed(1)}%` : "—"
                                }
                                widthPct={w}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Open incidents (vs max {maxInc})
                        </p>
                        <div className="space-y-1.5">
                          {series.map((s, idx) => {
                            const v = s.kpi.clinical.openIncidents;
                            return (
                              <CohortBarRow
                                key={`inc-${idx}`}
                                label={s.label}
                                display={String(v)}
                                widthPct={pctBarWidth(v, maxInc)}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Open deficiencies (vs max {maxDef})
                        </p>
                        <div className="space-y-1.5">
                          {series.map((s, idx) => {
                            const v = s.kpi.compliance.openSurveyDeficiencies;
                            return (
                              <CohortBarRow
                                key={`def-${idx}`}
                                label={s.label}
                                display={String(v)}
                                widthPct={pctBarWidth(v, maxDef)}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          AR balance (vs max {money.format(maxAr / 100)})
                        </p>
                        <div className="space-y-1.5">
                          {series.map((s, idx) => {
                            const c = s.kpi.financial.totalBalanceDueCents;
                            return (
                              <CohortBarRow
                                key={`ar-${idx}`}
                                label={s.label}
                                display={money.format(c / 100)}
                                widthPct={pctBarWidth(c, maxAr)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
