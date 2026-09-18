"use client";

/**
 * Tier 1 of the cadence settings surface. Spec 25A section 6.13.
 *
 * What this building runs: the checks per resident per day, the daily total from
 * the live active resident count, the longest span in which nobody looks at a
 * resident, the regulator floor that applies, the 24 hour strip, and the ladder
 * in wall clock terms.
 *
 * Every number is a row. The thresholds in the hints are the building's own,
 * not a constant, so a building that accepts a longer overnight span says so
 * here rather than being quietly warned against somebody else's number.
 */

import { CadenceLadderList } from "@/components/rounding/CadenceLadderList";
import { CadenceWindowStrip } from "@/components/rounding/CadenceWindowStrip";
import { RoundingEmptyNotice } from "@/components/rounding/RoundingNotices";
import { MetricCard } from "@/components/ui/metric-card";
import { formatSpanMinutes, type ObservationConfigOverview } from "@/lib/rounding/cadence-settings";
import {
  CADENCE_SETTINGS_EMPTY,
  LADDER_EMPTY,
  jurisdictionFloorLine,
} from "@/lib/rounding/cadence-settings-copy";

export function CadenceCurrentSummary({
  overview,
  onEditRung,
  onTestSend,
  testSendBusyRungKey,
}: {
  overview: ObservationConfigOverview;
  onEditRung: (rungKey: string) => void;
  onTestSend: (rungKey: string) => void;
  testSendBusyRungKey: string | null;
}) {
  const current = overview.current;
  const thresholds = overview.thresholds;

  return (
    <>
      <section aria-label="What this schedule asks of the building" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Checks per resident per day"
          value={current.day_shape?.windows_per_day ?? 0}
          numericValue={current.day_shape?.windows_per_day ?? 0}
          thresholds={{ type: "informational" }}
          hint={
            thresholds
              ? `This building treats more than ${thresholds.maximum_windows_per_resident_per_day} as unworkable`
              : undefined
          }
        />
        <MetricCard
          label="Checks a day across the building"
          value={current.daily_task_total ?? 0}
          numericValue={current.daily_task_total ?? 0}
          thresholds={{ type: "informational" }}
          hint={`${overview.active_resident_count} residents in the building right now`}
        />
        <MetricCard
          label="Longest unobserved span"
          value={formatSpanMinutes(current.day_shape?.largest_unobserved_gap_minutes ?? 0)}
          numericValue={current.day_shape?.largest_unobserved_gap_minutes ?? 0}
          thresholds={{ type: "informational" }}
          hint={
            thresholds
              ? `Past ${formatSpanMinutes(thresholds.maximum_unobserved_gap_minutes)} needs confirming`
              : undefined
          }
        />
      </section>

      {overview.jurisdiction_floor ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {jurisdictionFloorLine(overview.jurisdiction_floor)}
        </p>
      ) : null}

      {current.day_shape ? (
        <CadenceWindowStrip shape={current.day_shape} shifts={overview.shifts} label="The day as it runs now" />
      ) : (
        <RoundingEmptyNotice label="Observation schedule" copy={CADENCE_SETTINGS_EMPTY} />
      )}

      {current.ladder.length > 0 ? (
        <CadenceLadderList
          ladder={current.ladder}
          shape={current.day_shape}
          label="What happens when a check does not"
          onEdit={onEditRung}
          onTestSend={onTestSend}
          testSendBusyRungKey={testSendBusyRungKey}
        />
      ) : (
        <RoundingEmptyNotice label="Escalation ladder" copy={LADDER_EMPTY} />
      )}
    </>
  );
}
