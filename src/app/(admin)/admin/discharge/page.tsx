"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { KpiCard, type KpiCardTone } from "@/components/ui/kpi-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  dischargeHubScopeFromSearchParam,
  dischargeHubScopeLowerBoundUtc,
  type DischargeHubScope,
} from "@/lib/admin/discharge/hub-scope";

const NEW_MED_REC_PIPELINE_PATH = "/pipeline/discharge-management/new-reconciliation";

type RowT = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "nurse_reconciliation_notes"
  | "pharmacist_npi"
  | "pharmacist_notes"
> & {
  residents: {
    first_name: string;
    last_name: string;
    discharge_target_date: string | null;
    hospice_status: string;
  } | null;
};

type DischargePhase =
  | "planning"
  | "pharmacist_review"
  | "ready_to_complete"
  | "complete"
  | "cancelled";

type PhaseFilter = "all" | DischargePhase;

function formatStatusSentence(s: string) {
  return s.replace(/_/g, " ");
}

function describeDischargePhase(row: RowT): {
  phase: DischargePhase;
  helperText: string;
  nextActionLabel: string;
} {
  if (row.status === "cancelled") {
    return {
      phase: "cancelled",
      helperText: "Reconciliation cancelled.",
      nextActionLabel: "Cancelled",
    };
  }
  if (row.status === "complete") {
    return {
      phase: "complete",
      helperText: "Reconciliation workflow is complete.",
      nextActionLabel: "Complete",
    };
  }
  if (!row.residents?.discharge_target_date) {
    return {
      phase: "planning",
      helperText: "Set the resident discharge target date.",
      nextActionLabel: "Set discharge date",
    };
  }
  if (row.residents?.hospice_status === "pending") {
    return {
      phase: "planning",
      helperText: "Resolve hospice planning before transition completes.",
      nextActionLabel: "Confirm hospice",
    };
  }
  if (!row.nurse_reconciliation_notes?.trim()) {
    return {
      phase: "planning",
      helperText: "Add nurse reconciliation notes before pharmacist handoff.",
      nextActionLabel: "Add nurse notes",
    };
  }
  if (row.status === "draft") {
    return {
      phase: "pharmacist_review",
      helperText: "Ready to send for pharmacist attestation.",
      nextActionLabel: "Send for pharmacist review",
    };
  }
  if (!row.pharmacist_npi?.trim() || !row.pharmacist_notes?.trim()) {
    return {
      phase: "pharmacist_review",
      helperText: "Awaiting pharmacist attestation fields.",
      nextActionLabel: "Finish pharmacist review",
    };
  }
  return {
    phase: "ready_to_complete",
    helperText: "Pharmacist review is recorded; finalize when ready.",
    nextActionLabel: "Mark complete",
  };
}

function phaseFromSearchParam(raw: string | null): PhaseFilter {
  switch (raw) {
    case "planning":
    case "pharmacist_review":
    case "ready_to_complete":
    case "complete":
    case "cancelled":
      return raw;
    default:
      return "all";
  }
}

function youngestUpdatedMs(rows: RowT[]): number | null {
  if (!rows.length) return null;
  return rows.reduce<number | null>((min, row) => {
    const ms = Date.parse(row.updated_at);
    if (!Number.isFinite(ms)) return min;
    return min === null ? ms : Math.min(min, ms);
  }, null);
}

/** Hours since oldest `updated_at` in the cohort (staleness heuristic). */
function oldestAgeHours(rows: RowT[]): number | null {
  const y = youngestUpdatedMs(rows);
  if (y === null) return null;
  return (Date.now() - y) / (1000 * 60 * 60);
}

export default function AdminDischargeHubPage() {
  const supabase = createClient();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const { user } = useHavenAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowT[]>([]);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const scopeKey = dischargeHubScopeFromSearchParam(searchParams.get("scope"));
  const phaseFilter = phaseFromSearchParam(searchParams.get("phase"));

  type QueryPatch =
    | { mode: "set"; pairs: Record<string, string | undefined> }
    | { mode: "delete"; keys: string[] };

  const patchQuery = useCallback(
    (patch: QueryPatch) => {
      const next = new URLSearchParams(searchParams.toString());
      if (patch.mode === "set") {
        for (const [k, v] of Object.entries(patch.pairs)) {
          if (v === undefined || v === "") next.delete(k);
          else next.set(k, v);
        }
      } else {
        for (const k of patch.keys) next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs.length ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!searchParams.has("scope")) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("scope", "month");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const scopeIsoLower = dischargeHubScopeLowerBoundUtc(scopeKey);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      let api = supabase
        .from("discharge_med_reconciliation")
        .select(
          "id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (scopeIsoLower) {
        api = api.gte("updated_at", scopeIsoLower);
      }

      const { data: list, error: listErr } = await api;
      if (listErr) throw listErr;
      setRows((list ?? []) as RowT[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load med reconciliations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, scopeIsoLower, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateReconciliation(
    row: RowT,
    patch: Partial<Database["public"]["Tables"]["discharge_med_reconciliation"]["Update"]>,
    successMessage: string,
    event?: React.MouseEvent | React.BaseSyntheticEvent,
  ) {
    event?.preventDefault();
    event?.stopPropagation();

    setActionLoading(row.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error } = await supabase
        .from("discharge_med_reconciliation")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (error) throw error;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update med reconciliation.");
    } finally {
      setActionLoading(null);
    }
  }

  const noFacility =
    !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const facilityName = useMemo(() => {
    if (noFacility) return "the selected facility";
    const name = availableFacilities.find((f) => f.id === selectedFacilityId)?.name;
    return name ?? selectedFacilityId;
  }, [availableFacilities, noFacility, selectedFacilityId]);

  const planningRows = useMemo(
    () => rows.filter((row) => describeDischargePhase(row).phase === "planning"),
    [rows],
  );
  const pharmacistRows = useMemo(
    () => rows.filter((row) => describeDischargePhase(row).phase === "pharmacist_review"),
    [rows],
  );
  const readyRows = useMemo(
    () => rows.filter((row) => describeDischargePhase(row).phase === "ready_to_complete"),
    [rows],
  );

  const completeCount = rows.filter(
    (row) => describeDischargePhase(row).phase === "complete",
  ).length;
  const cancelledCount = rows.filter(
    (row) => describeDischargePhase(row).phase === "cancelled",
  ).length;

  const planningTone: KpiCardTone = useMemo(() => {
    if (planningRows.length === 0) return "neutral";
    const h = oldestAgeHours(planningRows);
    return h !== null && h > 24 ? "warning" : "neutral";
  }, [planningRows]);

  const pharmacistTone: KpiCardTone = useMemo(() => {
    if (pharmacistRows.length === 0) return "neutral";
    const h = oldestAgeHours(pharmacistRows);
    return h !== null && h > 48 ? "warning" : "neutral";
  }, [pharmacistRows]);

  const readyTone: KpiCardTone = readyRows.length > 0 ? "success" : "neutral";

  const filteredRows = useMemo(() => {
    if (phaseFilter === "all") return rows;
    return rows.filter(
      (row) => describeDischargePhase(row).phase === phaseFilter,
    );
  }, [phaseFilter, rows]);

  const filteredSortedRows = useMemo(() => {
    const phaseOrder: Record<DischargePhase, number> = {
      planning: 0,
      pharmacist_review: 1,
      ready_to_complete: 2,
      complete: 3,
      cancelled: 4,
    };
    return [...filteredRows].sort((a, b) => {
      const phaseA = describeDischargePhase(a).phase;
      const phaseB = describeDischargePhase(b).phase;
      const d = phaseOrder[phaseA] - phaseOrder[phaseB];
      if (d !== 0) return d;
      return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    });
  }, [filteredRows]);

  function setScope(next: DischargeHubScope) {
    patchQuery({ mode: "set", pairs: { scope: next } });
  }

  function setPhase(next: PhaseFilter) {
    patchQuery({
      mode: "set",
      pairs: { phase: next === "all" ? undefined : next },
    });
  }

  const filterOptions: Array<{ value: PhaseFilter; label: string }> = useMemo(() => {
    const total = rows.length;
    const pl = planningRows.length;
    const ph = pharmacistRows.length;
    const rd = readyRows.length;

    const pharmacistLabelShort = `Sent for external pharmacist review (${ph})`;

    return [
      { value: "all", label: `All (${total})` },
      { value: "planning", label: `Planning gaps (${pl})` },
      { value: "pharmacist_review", label: pharmacistLabelShort },
      { value: "ready_to_complete", label: `Ready to complete (${rd})` },
      { value: "complete", label: `Complete (${completeCount})` },
      { value: "cancelled", label: `Cancelled (${cancelledCount})` },
    ];
  }, [
    planningRows.length,
    pharmacistRows.length,
    readyRows.length,
    cancelledCount,
    completeCount,
    rows.length,
  ]);

  return (
    <TooltipProvider delay={300}>
      <div className="mx-auto w-full max-w-5xl space-y-8 pb-16 pt-2">
        <PageHeader
          title="Discharge & transition"
          subtitle={
            <>
              Medication reconciliation pipeline for{" "}
              <span className="text-foreground">{facilityName}</span>.
            </>
          }
          actions={
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <div className="flex min-w-[200px] items-center gap-2">
                <span className="sr-only">Time scope</span>
                <Select
                  value={scopeKey}
                  onValueChange={(v) =>
                    setScope(dischargeHubScopeFromSearchParam(v))
                  }
                >
                  <SelectTrigger
                    aria-label="Time scope"
                    className="h-9 w-[200px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This week</SelectItem>
                    <SelectItem value="month">This month</SelectItem>
                    <SelectItem value="quarter">This quarter</SelectItem>
                    <SelectItem value="all">All time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Link
                href={NEW_MED_REC_PIPELINE_PATH}
                aria-label="Start new med reconciliation"
                className={cn(
                  buttonVariants({ variant: "default", size: "default" }),
                  "inline-flex shrink-0 items-center gap-2",
                )}
              >
                <Plus className="size-4" aria-hidden />
                New med rec
              </Link>
            </div>
          }
        />

        {noFacility ? (
          <div role="status" className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Select a facility in the header to load med reconciliations.
          </div>
        ) : null}

        {!noFacility ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Needs attention</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tooltip>
                <TooltipTrigger className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <KpiCard
                    value={loading ? "—" : planningRows.length}
                    label="Planning gaps"
                    tone={planningTone}
                  />
                </TooltipTrigger>
                <TooltipContent align="center" side="bottom" className="max-w-xs">
                  Med recs with missing meds, missing prescriber, or expected discharge date in the past.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <KpiCard
                    value={loading ? "—" : pharmacistRows.length}
                    label="Sent for external pharmacist review"
                    tone={pharmacistTone}
                  />
                </TooltipTrigger>
                <TooltipContent align="center" side="bottom" className="max-w-xs">
                  Drafts sent for pharmacist review, not yet returned.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <KpiCard
                    value={loading ? "—" : readyRows.length}
                    label="Ready to complete"
                    tone={readyTone}
                  />
                </TooltipTrigger>
                <TooltipContent align="center" side="bottom" className="max-w-xs">
                  Pharmacist-approved, awaiting final sign-off.
                </TooltipContent>
              </Tooltip>
            </div>
          </section>
        ) : null}

        {actionError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {actionError}
          </div>
        ) : null}
        {actionMessage ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-900 dark:text-emerald-300">
            {actionMessage}
          </div>
        ) : null}

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Reconciliations</h2>

          {loadError ?
            <p className="text-sm text-destructive" role="alert">
              {loadError}
            </p>
          : null}

          <div className="overflow-hidden rounded-xl border border-border bg-card px-4 py-4 md:px-5 md:py-5">
            <div className="mb-4 flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <Button
                  key={option.value === "all" ? "all-phase" : option.value}
                  type="button"
                  size="sm"
                  variant={
                    phaseFilter === option.value ? "secondary" : "ghost"
                  }
                  className="h-auto min-h-9 max-w-[min(100%,24rem)] justify-start whitespace-normal px-3 py-2 text-left text-[13px] font-medium leading-snug tracking-normal transition-colors [&_span]:leading-snug"
                  onClick={() => setPhase(option.value)}
                >
                  {option.label}
                </Button>
              ))}
              {phaseFilter !== "all" ?
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="h-auto min-h-9 px-2 text-[13px] font-normal"
                  onClick={() => setPhase("all")}
                >
                  Clear filters
                </Button>
              : null}
            </div>

            {noFacility ?
              <p className="py-10 text-center text-sm text-muted-foreground">
                Select a facility to view reconciliations.
              </p>
            : loading ?
              <p className="py-10 text-center text-sm text-muted-foreground">
                Loading reconciliations…
              </p>
            : (
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Resident</TableHead>
                    <TableHead>Record status</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead className="w-[230px]">Updated</TableHead>
                    <TableHead className="w-[260px] text-right">Quick actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {
                    rows.length === 0 ?
                      <TableRow>
                        <TableCell colSpan={5} className="align-top">
                          <div className="max-w-lg space-y-3 py-6 text-[13px] leading-relaxed text-muted-foreground">
                            <p>No med recs yet.</p>
                            <p>
                              <Link
                                href={NEW_MED_REC_PIPELINE_PATH}
                                className={cn(
                                  buttonVariants({ variant: "link", size: "xs" }),
                                  "gap-2 px-0 text-[13px] font-semibold",
                                )}
                              >
                                <Plus className="size-4" aria-hidden />
                                Start your first med rec
                              </Link>
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    : filteredSortedRows.length === 0 ?
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-sm text-muted-foreground"
                        >
                          No reconciliations match this filter yet.
                        </TableCell>
                      </TableRow>
                    : filteredSortedRows.map((r) => {
                        const phase = describeDischargePhase(r);

                        const detailHref = `/admin/discharge/${r.id}`;

                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium align-top">
                              <Link
                                href={detailHref}
                                className="text-foreground underline-offset-4 hover:underline"
                              >
                                {r.residents ?
                                  `${r.residents.first_name} ${r.residents.last_name}`
                                : "Unknown resident"}
                              </Link>
                            </TableCell>
                            <TableCell className="align-top text-[13px] text-muted-foreground">
                              <Badge variant="outline" className="font-normal capitalize">
                                {formatStatusSentence(r.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[320px] align-top text-[13px] leading-snug text-muted-foreground">
                              <Badge variant="outline" className="mb-2 font-normal">
                                {phase.nextActionLabel}
                              </Badge>
                              <p>{phase.helperText}</p>
                            </TableCell>
                            <TableCell className="align-top text-[13px] leading-snug text-muted-foreground">
                              {new Date(r.updated_at).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </TableCell>
                            <TableCell className="space-y-2 text-right align-top">
                              <div className="flex flex-wrap justify-end gap-2">
                                {
                                  phase.phase === "pharmacist_review" &&
                                  r.status === "draft"
                                ?
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={actionLoading === r.id}
                                    onMouseDown={(e) => void e.preventDefault()}
                                    onClick={(e) =>
                                      void updateReconciliation(
                                        r,
                                        { status: "pharmacist_review" },
                                        "Sent for pharmacist review.",
                                        e,
                                      )
                                    }
                                  >
                                    {actionLoading === r.id ?
                                      <Loader2 className="size-3.5 animate-spin" />
                                    : "Send for review"}
                                  </Button>
                                : null}

                                {
                                  phase.phase === "ready_to_complete"
                                ?
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={actionLoading === r.id}
                                    onMouseDown={(e) => void e.preventDefault()}
                                    onClick={(e) =>
                                      void updateReconciliation(
                                        r,
                                        {
                                          status: "complete",
                                          pharmacist_reviewed_at: new Date().toISOString(),
                                          pharmacist_reviewed_by:
                                            user?.id ?? null,
                                        },
                                        "Marked complete.",
                                        e,
                                      )
                                    }
                                  >
                                    {actionLoading === r.id ?
                                      <Loader2 className="size-3.5 animate-spin" />
                                    : "Mark complete"}
                                  </Button>
                                : null}
                              </div>
                              <Link
                                href={detailHref}
                                className={cn(
                                  buttonVariants({ variant: "link", size: "xs" }),
                                  "justify-end px-0 text-[12px] font-normal",
                                )}
                              >
                                Open workflow
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })
                  }
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
