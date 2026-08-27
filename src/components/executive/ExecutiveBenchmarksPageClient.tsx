"use client";

import { useState, type FormEvent } from "react";
import { BarChart3 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
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
import { executiveKpiEmptyCopy } from "@/lib/executive/kpi-tile-copy";
import {
  EXECUTIVE_CROSS_OPERATOR_GAP_COPY,
  EXECUTIVE_CROSS_OPERATOR_OPT_IN_NOTE,
  formatExecutiveBenchmarkFacilitiesDisplay,
} from "@/lib/executive/executive-benchmarks-display-copy";
import {
  formatExecutiveOccupancyBarLabel,
  formatExecutiveOccupancyPct,
} from "@/lib/executive/executive-display-copy";
import type { CrossOperatorBenchmarkSettingRow, ExecutiveBenchmarksData } from "@/lib/executive/load-benchmark-data";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CohortRow = Database["public"]["Tables"]["benchmark_cohorts"]["Row"];

type ExecutiveBenchmarksPageClientProps = {
  initialData: ExecutiveBenchmarksData | null;
  initialError: string | null;
  initialOrgId: string | null;
  initialCanManage: boolean;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function pctBarWidth(value: number, max: number): number {
  if (max <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function CohortBarRow({
  label,
  display,
  widthPct,
  namedGap = false,
}: {
  label: string;
  display: string;
  widthPct: number;
  namedGap?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 text-sm"
      aria-label={namedGap ? `${label}: ${display}` : undefined}
    >
      <span className="w-36 shrink-0 truncate font-medium sm:w-44" title={label}>
        {label}
      </span>
      <div
        className={cn(
          "h-2.5 min-w-[72px] flex-1 rounded-full",
          namedGap ? "border border-dashed border-muted-foreground/35 bg-transparent" : "bg-muted",
        )}
      >
        {!namedGap && (
          <div
            className="h-2.5 rounded-full bg-info/70 transition-[width] duration-[var(--motion-duration)]"
            style={{ width: `${widthPct}%` }}
          />
        )}
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{display}</span>
    </div>
  );
}

export default function ExecutiveBenchmarkCohortsPageClient({
  initialData,
  initialError,
  initialOrgId,
  initialCanManage,
}: ExecutiveBenchmarksPageClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const { user } = useHavenAuth();
  const [localError, setLocalError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [crossOperatorBusy, setCrossOperatorBusy] = useState(false);

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

  const error = localError ?? initialError;
  const rows = initialData?.rows ?? [];
  const facilities = initialData?.facilities ?? [];
  const orgId = initialOrgId;
  const canManage = initialCanManage;
  const crossOperatorSetting: CrossOperatorBenchmarkSettingRow | null =
    initialData?.crossOperatorSetting ?? null;
  const loading = false;

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
      setLocalError("Name is required.");
      return;
    }
    const minN = Math.max(5, Math.min(9999, Math.floor(formMinimumN) || 5));
    const facility_ids = [...formFacilityIds];

    setBusyId(editingId ?? "__new__");
    setLocalError(null);
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
      router.refresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(row: CohortRow) {
    if (!canManage || !orgId) return;
    if (!window.confirm(`Remove benchmark cohort "${row.name}"?`)) return;
    setBusyId(row.id);
    setLocalError(null);
    try {
      const { error: dErr } = await supabase
        .from("benchmark_cohorts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", orgId);
      if (dErr) throw new Error(dErr.message);
      router.refresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Remove failed.");
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

  async function requestCrossOperatorAccess() {
    if (!canManage || !orgId) return;

    setCrossOperatorBusy(true);
    setLocalError(null);
    try {
      if (!user?.id) throw new Error("Sign in required.");

      if (crossOperatorSetting) {
        const { error: updateError } = await supabase
          .from("cross_operator_benchmark_settings" as never)
          .update({
            status: "requested",
            enabled: false,
            requested_at: new Date().toISOString(),
            requested_by: user.id,
            terms_acknowledged_at: new Date().toISOString(),
            notes: EXECUTIVE_CROSS_OPERATOR_OPT_IN_NOTE,
          } as never)
          .eq("id", crossOperatorSetting.id)
          .eq("organization_id", orgId);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await supabase.from("cross_operator_benchmark_settings" as never).insert({
          organization_id: orgId,
          enabled: false,
          status: "requested",
          requested_by: user.id,
          requested_at: new Date().toISOString(),
          terms_acknowledged_at: new Date().toISOString(),
          notes: EXECUTIVE_CROSS_OPERATOR_OPT_IN_NOTE,
        } as never);
        if (insertError) throw new Error(insertError.message);
      }

      router.refresh();
    } catch (caughtError) {
      setLocalError(caughtError instanceof Error ? caughtError.message : "Unable to record opt-in request.");
    } finally {
      setCrossOperatorBusy(false);
    }
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
          <BarChart3 className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Benchmark cohorts</h1>
            <p className="text-sm text-muted-foreground">
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

      {!loading && (
        <Card className="border-info/30 bg-info/10">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Cross-operator benchmarking</CardTitle>
                <CardDescription>
                  {EXECUTIVE_CROSS_OPERATOR_GAP_COPY}
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {crossOperatorSetting
                  ? crossOperatorSetting.enabled
                    ? "Approved"
                    : crossOperatorSetting.status === "declined"
                      ? "Declined"
                      : "Requested"
                  : "Not requested"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              External peer KPIs are not available in Haven today. Opt-in only records governance intent, legal/privacy
              acknowledgement, and approval state for a future benchmark feed.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-info/20 bg-card px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Request</p>
                <p>{crossOperatorSetting?.requested_at ? new Date(crossOperatorSetting.requested_at).toLocaleString() : "Not recorded"}</p>
              </div>
              <div className="rounded-md border border-info/20 bg-card px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Terms acknowledged</p>
                <p>
                  {crossOperatorSetting?.terms_acknowledged_at
                    ? new Date(crossOperatorSetting.terms_acknowledged_at).toLocaleString()
                    : "Pending"}
                </p>
              </div>
              <div className="rounded-md border border-info/20 bg-card px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Approval</p>
                <p>{crossOperatorSetting?.approved_at ? new Date(crossOperatorSetting.approved_at).toLocaleString() : "Not approved"}</p>
              </div>
            </div>
            {crossOperatorSetting?.notes ? (
              <p className="rounded-md border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground">
                {crossOperatorSetting.notes}
              </p>
            ) : null}
            {canManage ? (
              <Button type="button" variant="outline" disabled={crossOperatorBusy} onClick={() => void requestCrossOperatorAccess()}>
                {crossOperatorBusy
                  ? "Recording…"
                  : crossOperatorSetting?.status === "declined"
                    ? "Resubmit opt-in"
                    : crossOperatorSetting
                      ? "Refresh opt-in request"
                      : "Request opt-in"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      {!canManage && !loading && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
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
                    "flex min-h-[72px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm",
                    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                  {facilities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No facilities in this organization.</p>
                  ) : (
                    facilities.map((f) => (
                      <label key={f.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="rounded border-border"
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
              <p className="text-sm text-muted-foreground">No benchmark cohorts yet.</p>
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
                  {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.description ? (
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">{r.description}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.minimum_n}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-muted-foreground">
                          {formatExecutiveBenchmarkFacilitiesDisplay({
                            facilityIds: r.facility_ids,
                            facNameById,
                          })}
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
                            <span className="text-xs text-muted-foreground">View only</span>
                          )}
                        </TableCell>
                      </TableRow>
                  ))}
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
                  className="flex h-10 min-w-[200px] rounded-md border border-border bg-background px-3 py-2 text-sm"
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
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    This cohort has fewer than <strong>{compareData.cohort.minimum_n}</strong> facilities — peer
                    benchmarks are not statistically surfaced; table is for operational review only.
                  </p>
                )}
                <div className="overflow-x-auto rounded-md border border-border">
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
                      <TableRow className="bg-muted/40">
                        <TableCell className="font-medium">Organization (portfolio)</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatExecutiveOccupancyPct(compareData.orgKpi.census.occupancyPct)}
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
                            {formatExecutiveOccupancyPct(f.kpi.census.occupancyPct)}
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
                    <div className="space-y-6 rounded-[var(--radius)] border border-border bg-muted/40 p-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Visual comparison (CSS bars)
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Occupancy uses 0–100%. Incidents, deficiencies, and AR scale to the highest value in this
                          cohort plus portfolio row (operational view, not statistical inference).
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Occupancy</p>
                        <div className="space-y-1.5">
                          {series.map((s, idx) => {
                            const occ = s.kpi.census.occupancyPct;
                            const namedGap = occ == null || !Number.isFinite(occ);
                            const display = namedGap
                              ? executiveKpiEmptyCopy("occ_pt")
                              : formatExecutiveOccupancyBarLabel(occ);
                            const w =
                              !namedGap && occ != null && Number.isFinite(occ)
                                ? pctBarWidth(Math.min(100, Math.max(0, occ)), 100)
                                : 0;
                            return (
                              <CohortBarRow
                                key={`occ-${idx}`}
                                label={s.label}
                                display={display}
                                widthPct={w}
                                namedGap={namedGap}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
