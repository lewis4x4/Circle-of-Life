"use client";

/**
 * Observation compliance and on-time rate, on Integrity. Spec 25A section 7.1.
 *
 * These numbers used to sit on resident rows, blended into a 0-to-100 score.
 * Section 7.1 retired that, and the reason is worth keeping next to the code:
 * compliance and on-time rate measure whether staff documented a check, so a
 * number on a resident row makes a resident read as declining because their
 * caregiver ran late. They belong to the building and its shifts, halls and
 * staff members, which is what this panel cuts them by.
 *
 * Unconfigured windows are a first class number here and are never folded into
 * the rate. A window whose cadence never resolved is an unsatisfied expectation
 * with a configuration cause, and a surface that shows satisfied over expected
 * and hides it has put the dishonesty back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  roundingReportRangeForPreset,
  type DateRangePreset,
} from "@/lib/rounding/rounding-reports-date-range";
import {
  complianceRate,
  formatComplianceRate,
  onTimeRate,
  complianceRateMetric,
  formatCompliancePercent,
  type ComplianceCut,
  type ComplianceSummary,
} from "@/lib/rounding/observation-compliance-summary";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

const LOAD_FAILED =
  "Observation compliance could not be loaded. Retry, or try again in a moment.";

export function IntegrityCompliancePanel({ facilityId }: { facilityId: string | null }) {
  return <ScopedIntegrityCompliancePanel key={facilityId ?? "none"} facilityId={facilityId} />;
}

function ScopedIntegrityCompliancePanel({ facilityId }: { facilityId: string | null }) {
  const [preset, setPreset] = useState<DateRangePreset>("last_7");
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => roundingReportRangeForPreset(preset), [preset]);

  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setSummary(null);
    if (!facilityId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/rounding/compliance?facilityId=${encodeURIComponent(facilityId)}&from=${range.from}&to=${range.to}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | (ComplianceSummary & { error?: string })
        | null;
      if (sequence !== requestSequence.current) return;
      if (!response.ok || !payload || payload.error) {
        setSummary(null);
        setError(payload?.error ?? LOAD_FAILED);
        return;
      }
      setSummary(payload);
    } catch {
      if (sequence !== requestSequence.current) return;
      setSummary(null);
      setError(LOAD_FAILED);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [facilityId, range.from, range.to]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  if (!facilityId) return null;

  const totals = summary?.totals;

  return (
    <section aria-label="Observation compliance" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Observation compliance</h2>
          <p className="text-[12px] text-muted-foreground">
            Windows the cadence in force expected, against what was recorded. Cut by shift, hall and
            staff member.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={preset} onValueChange={(next) => setPreset(next as DateRangePreset)}>
            <SelectTrigger className="h-8 w-[160px] text-[13px]" aria-label="Compliance date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh observation compliance"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
          </Button>
        </div>
      </div>

      {error ? (
        // A failed read is only ever a failed read — never the "no residents" explanation.
        <RoundingErrorNotice message={error} onRetry={() => void load()} />
      ) : !totals ? (
        <RoundingEmptyNotice
          label="Observation compliance"
          copy={{ why: "Loading compliance.", guidance: "The window projection is on its way." }}
        />
      ) : totals.expected === 0 && totals.unconfigured === 0 ? (
        <RoundingEmptyNotice
          label="Observation compliance"
          copy={{
            why: "No compliance figures for this range.",
            guidance: "Figures appear once the building has residents in occupancy over the dates selected.",
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
              label="Recorded late"
              value={totals.late}
              numericValue={totals.late}
              thresholds={{ type: "overdue-count" }}
              hint="Recorded after the grace window closed"
            />
            <MetricCard
              label="Unconfigured"
              value={totals.unconfigured}
              numericValue={totals.unconfigured}
              thresholds={{ type: "critical-count" }}
              hint="Resident days no cadence resolved for. A configuration gap, not a missed check"
            />
            <MetricCard
              label="Absorbed"
              value={totals.absorbed}
              numericValue={totals.absorbed}
              thresholds={{ type: "informational" }}
              hint="Standard windows a Monitoring Order check satisfied"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            <ComplianceCutTable title="By shift" rows={summary.byShift} />
            <ComplianceCutTable title="By hall" rows={summary.byHall} />
            <ComplianceCutTable title="By staff member" rows={summary.byStaff} />
          </div>
        </>
      )}
    </section>
  );
}

function ComplianceCutTable({ title, rows }: { title: string; rows: ComplianceCut[] }) {
  return (
    <div role="region" aria-label={title} tabIndex={0} className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-[13px]">
        <caption className="border-b border-border px-4 py-2 text-left text-[13px] font-semibold text-foreground">
          {title}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th scope="col" className="px-4 py-1.5 font-medium">
              Group
            </th>
            <th scope="col" className="px-4 py-1.5 text-right font-medium">
              Recorded
            </th>
            <th scope="col" className="px-4 py-1.5 text-right font-medium">
              On time
            </th>
            <th scope="col" className="px-4 py-1.5 text-right font-medium">
              Unconfigured
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-2 text-muted-foreground">
                No rows for this range.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-b-0">
                <td className="px-4 py-1.5 text-foreground">{row.label}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-foreground">
                  {formatComplianceRate(complianceRate(row))}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-foreground">
                  {formatComplianceRate(onTimeRate(row))}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-foreground">
                  {row.unconfigured}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
