"use client";

/**
 * Resident Safety Scores Dashboard
 * Shows composite safety scores per resident with risk tier distribution.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Building2,
  Minus,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { SafetyScoreBadge } from "@/components/rounding/SafetyScoreBadge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type RiskTier = "low" | "moderate" | "high" | "critical";

interface ScoreRow {
  id: string;
  resident_id: string;
  facility_id: string;
  score: number;
  risk_tier: RiskTier;
  component_scores: Record<string, number>;
  previous_score: number | null;
  score_delta: number | null;
  computed_at: string;
  residents?: { first_name: string; last_name: string; room_number: string | null } | null;
  facilities?: { name: string } | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState = "no_facility" | "loading" | "error" | "empty" | "populated";

type Tone = "default" | "warning" | "danger";

/* -------------------------------------------------------------------------- */
/*  Tier helpers — value-derived                                              */
/* -------------------------------------------------------------------------- */

function resolveTierTone(tier: RiskTier, count: number): Tone {
  if (count === 0) return "default";
  if (tier === "critical") return "danger";
  if (tier === "high") return "warning";
  return "default";
}

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
  rowCount: number;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.rowCount === 0) return "empty";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function SafetyScoresPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find((facility) => facility.id === selectedFacilityId);
  const facilityName = selectedFacility?.name ?? "selected facility";
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      setLoadState("ready");
      return;
    }

    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      const { data, error } = await supabase
        .from("resident_safety_scores")
        .select("*, residents(first_name, last_name, room_number), facilities(name)")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("score", { ascending: true })
        .limit(200);

      if (error) throw error;
      setRows((data ?? []) as ScoreRow[]);
      setLoadState("ready");
    } catch (err) {
      setErrorMessage(
        formatLiveDataLoadError(err, "Could not load safety scores. Confirm facility scope and retry."),
      );
      setRows([]);
      setLoadState("error");
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dist = useMemo(() => {
    const acc: Record<RiskTier, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
    for (const row of rows) acc[row.risk_tier] += 1;
    return acc;
  }, [rows]);

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    rowCount: rows.length,
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Resident safety scores"
        subtitle={`Composite safety scores updated daily from observation compliance, incident recency, and medication adherence at ${facilityName}.`}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh safety scores"
            title="Refresh"
            disabled={loadState === "loading"}
          >
            <RefreshCw
              className={cn("size-4", loadState === "loading" && "animate-spin")}
              aria-hidden
            />
          </Button>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load safety scores."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {/* Tier distribution */}
          <section aria-label="Risk tier distribution">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TierCard
                label="Critical risk"
                value={dist.critical}
                tone={resolveTierTone("critical", dist.critical)}
                hint="Immediate safety review required"
              />
              <TierCard
                label="High risk"
                value={dist.high}
                tone={resolveTierTone("high", dist.high)}
                hint="Watch protocols and frequent rounds"
              />
              <TierCard
                label="Moderate risk"
                value={dist.moderate}
                tone="default"
                hint="Standard observation cadence"
              />
              <TierCard
                label="Low risk"
                value={dist.low}
                tone="default"
                hint="Routine monitoring"
              />
            </div>
          </section>

          {boardState === "empty" ? (
            <NoScoresEmptyState facilityName={facilityName} />
          ) : (
            <section
              aria-label="Resident safety score table"
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Resident</th>
                      <th className="px-3 py-2.5">Facility</th>
                      <th className="px-3 py-2.5">Room</th>
                      <th className="px-3 py-2.5">Score</th>
                      <th className="px-3 py-2.5">Trend</th>
                      <th className="px-3 py-2.5">Obs compliance</th>
                      <th className="px-3 py-2.5">Incidents</th>
                      <th className="px-3 py-2.5">Med adherence</th>
                      <th className="px-3 py-2.5">Last computed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => {
                      const name = row.residents
                        ? `${row.residents.last_name}, ${row.residents.first_name}`
                        : row.resident_id.slice(0, 8);
                      const cs = row.component_scores as Record<string, number>;
                      const delta = row.score_delta;

                      return (
                        <tr key={row.id} className="transition-colors hover:bg-muted/40">
                          <td className="px-3 py-2.5 font-medium text-foreground">{name}</td>
                          <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                            {row.facilities?.name ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-[13px] text-muted-foreground">
                            {row.residents?.room_number ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <SafetyScoreBadge
                              score={row.score}
                              tier={row.risk_tier}
                              size="sm"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            {delta != null ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 text-[12px] tabular-nums",
                                  delta > 0 && "text-success",
                                  delta < 0 && "text-danger",
                                  delta === 0 && "text-muted-foreground",
                                )}
                              >
                                {delta > 0 ? (
                                  <TrendingUp className="size-3" aria-hidden />
                                ) : delta < 0 ? (
                                  <TrendingDown className="size-3" aria-hidden />
                                ) : (
                                  <Minus className="size-3" aria-hidden />
                                )}
                                {delta > 0 ? "+" : ""}
                                {delta}
                              </span>
                            ) : (
                              <span className="text-[12px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-[13px] text-foreground">
                            {cs.observation_compliance != null
                              ? `${cs.observation_compliance.toFixed(0)}%`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-[13px] text-foreground">
                            {cs.incident_recency != null
                              ? cs.incident_recency.toFixed(0)
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-[13px] text-foreground">
                            {cs.medication_adherence != null
                              ? `${cs.medication_adherence.toFixed(0)}%`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-muted-foreground">
                            {new Date(row.computed_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tier card                                                                  */
/* -------------------------------------------------------------------------- */

function TierCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: Tone;
  hint: string;
}) {
  const thresholds = label === "Critical risk" ? ({ type: "critical-count" } as const) : label === "High risk" ? ({ type: "overdue-count" } as const) : ({ type: "informational" } as const);
  return (
    <MetricCard
      label={label}
      value={value}
      numericValue={value}
      thresholds={thresholds}
      tone={tone === "default" ? undefined : tone}
      hint={value === 1 ? `1 resident · ${hint}` : `${value} residents · ${hint}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Notices + empty states                                                    */
/* -------------------------------------------------------------------------- */

function AllFacilitiesInterstitial() {
  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-card p-6"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Safety scores operate per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Composite safety scores are facility-scoped. Select a facility from the top bar to
            continue.
          </p>
        </div>
      </div>
    </section>
  );
}

function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
    </div>
  );
}

function NoScoresEmptyState({ facilityName }: { facilityName: string }) {
  return (
    <section
      aria-label="No safety scores computed"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <Shield className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No safety scores at {facilityName}
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Safety score snapshots will appear here after the next scoring cycle.
      </p>
    </section>
  );
}
