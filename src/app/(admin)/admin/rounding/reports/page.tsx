"use client";

/**
 * Observation reports. Spec 25A sections 6.3 and 7.1, defect 9.
 *
 * Insights folded in here, at the bottom of the page: it is a periodic read
 * rather than a place work happens, so it did not need a destination of its
 * own.
 *
 * Two things about the numbers matter more than the layout.
 *
 * First, they come from `public.observation_compliance_for_range` and not from
 * counting `resident_observation_tasks`. The route this page used to call
 * counted task rows, which is structurally wrong in two directions at once:
 * a resident on a thirty minute Monitoring Order has no standard task rows, so
 * task counting reported them as missing six windows a day, and a resident day
 * nothing was generated for has no rows either, so task counting divided zero
 * by zero and a dashboard read that as a hundred percent.
 *
 * Second, there is no per resident cut any more. The old report broke
 * completion down by resident, which is a rate on a resident row measuring
 * whether staff documented a check. Spec section 7.1 and decision D5 both put
 * that out of the module. The shift and staff cuts stayed, and the hall cut
 * lives with the rest of them on Integrity.
 *
 * Shift labels come from `facility_shift_definitions` through the compliance
 * route, never from `shift_assignments.shift_type`. That column is the roster
 * enum and still carries `evening` for other modules; rendering it is how the
 * retired three-daypart model kept appearing in a two-shift building.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { ObservationInsightsPanel } from "@/components/rounding/ObservationInsightsPanel";
import { ReportBreakdown } from "@/components/rounding/ObservationReportBreakdown";
import { ObservationReportRange } from "@/components/rounding/ObservationReportRange";
import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  complianceRate,
  onTimeRate,
  complianceRateMetric,
  formatCompliancePercent,
  type ComplianceSummary,
} from "@/lib/rounding/observation-compliance-summary";
import {
  buildComplianceReportCsv,
  downloadComplianceReportCsv,
} from "@/lib/rounding/compliance-report-csv";
import {
  defaultRoundingReportLast7Days,
  roundingReportRangeForPreset,
  type DateRangePreset,
} from "@/lib/rounding/rounding-reports-date-range";
import {
  formatRoundingReportsPageSubtitle,
  resolveRoundingReportsFacilityScope,
} from "@/lib/rounding/rounding-reports-display-copy";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type LoadState = "idle" | "loading" | "ready" | "error";

const LOAD_FAILED = "The report could not be built. Confirm the range and retry.";

export default function AdminRoundingReportsPage() {
  const { selectedFacilityId } = useFacilityStore();
  return <ScopedAdminRoundingReportsPage key={selectedFacilityId ?? "portfolio"} />;
}

function ScopedAdminRoundingReportsPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const scope = resolveRoundingReportsFacilityScope(
    selectedFacilityId,
    availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name,
  );

  const initialRange = useMemo(() => defaultRoundingReportLast7Days(), []);
  const [preset, setPreset] = useState<DateRangePreset>("last_7");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setSummary(null);
    setErrorMessage(null);
    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setSummary(null);
      setLoadState("ready");
      return;
    }

    setLoadState("loading");
    try {
      const response = await fetch(
        `/api/rounding/compliance?facilityId=${encodeURIComponent(selectedFacilityId)}&from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | (ComplianceSummary & { error?: string })
        | null;
      if (sequence !== requestSequence.current) return;
      if (!response.ok || !payload || payload.error) {
        setSummary(null);
        setErrorMessage(payload?.error ?? LOAD_FAILED);
        setLoadState("error");
        return;
      }
      setSummary(payload);
      setLoadState("ready");
    } catch {
      if (sequence !== requestSequence.current) return;
      setSummary(null);
      setErrorMessage(LOAD_FAILED);
      setLoadState("error");
    }
  }, [from, selectedFacilityId, to]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  function changePreset(value: DateRangePreset) {
    setPreset(value);
    if (value === "custom") return;
    const next = roundingReportRangeForPreset(value);
    setFrom(next.from);
    setTo(next.to);
  }

  const totals = summary?.totals;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Observation reports"
        subtitle={formatRoundingReportsPageSubtitle(scope)}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => summary && downloadComplianceReportCsv(summary)}
              disabled={!summary}
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh the report"
              title="Refresh"
              disabled={loadState === "loading"}
            >
              <RefreshCw
                className={cn("size-4", loadState === "loading" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {!selectedFacilityId ? (
        <RoundingEmptyNotice
          label="Facility scope required"
          copy={{
            why: "No building selected.",
            guidance: "Choose one in the top bar to build a report for it.",
          }}
        />
      ) : (
        <>
          {errorMessage ? (
            <RoundingErrorNotice message={errorMessage} onRetry={() => void load()} />
          ) : null}

          <ObservationReportRange
            preset={preset}
            from={from}
            to={to}
            busy={loadState === "loading"}
            onPresetChange={changePreset}
            onFromChange={(value) => {
              setFrom(value);
              setPreset("custom");
            }}
            onToChange={(value) => {
              setTo(value);
              setPreset("custom");
            }}
            onBuild={() => void load()}
          />

          {loadState === "error" ? null : !totals ? (
            <RoundingEmptyNotice
              label="No report built"
              copy={
                loadState === "loading"
                  ? { why: "Building the report.", guidance: "The window projection is on its way." }
                  : { why: "No report built yet.", guidance: "Choose a building and dates, then build the report." }
              }
            />
          ) : totals.expected === 0 && totals.unconfigured === 0 ? (
            <RoundingEmptyNotice
              label="No report built"
              copy={{
                why: "No expected windows in this range.",
                guidance: "A report appears once the building had residents in occupancy over the dates selected.",
              }}
            />
          ) : (
            <>
              <section aria-label="Report totals">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MetricCard
                    label="Compliance"
                    state={complianceRateMetric(complianceRate(totals))}
                    format={formatCompliancePercent}
                    thresholds={{ type: "rate-percent" }}
                    hint={`${totals.satisfied} of ${totals.expected} expected windows recorded`}
                  />
                  <MetricCard
                    label="On time"
                    state={complianceRateMetric(onTimeRate(totals))}
                    format={formatCompliancePercent}
                    thresholds={{ type: "rate-percent" }}
                    hint={`${totals.onTime} of ${totals.withTask} scheduled checks inside the grace window`}
                  />
                  <MetricCard
                    label="Not recorded"
                    value={totals.expected - totals.satisfied}
                    numericValue={totals.expected - totals.satisfied}
                    thresholds={{ type: "overdue-count" }}
                    hint="Expected windows with nothing written against them"
                  />
                  <MetricCard
                    label="Unconfigured"
                    value={totals.unconfigured}
                    numericValue={totals.unconfigured}
                    thresholds={{ type: "critical-count" }}
                    hint="Resident days no cadence resolved for. A configuration gap, not a missed check"
                  />
                </div>
              </section>

              <ReportBreakdown title="By shift" rows={summary.byShift} />
              <ReportBreakdown title="By staff member" rows={summary.byStaff} />

              <p className="text-[12px] text-muted-foreground">
                {buildComplianceReportCsv(summary).length - 1} rows export to CSV. Halls are cut on
                the Integrity tab, alongside the rest of the compliance detail.
              </p>
            </>
          )}

          <ObservationInsightsPanel facilityId={selectedFacilityId} />
        </>
      )}
    </div>
  );
}
