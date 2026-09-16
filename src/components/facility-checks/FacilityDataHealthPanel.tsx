"use client";

import Link from "next/link";

import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  censusComparisonLine,
  dataHealthCounts,
  formatStandUpWeek,
  lastCheckLine,
  type FacilityDataHealth,
} from "@/lib/facility-checks/data-health";

/**
 * Data Health — a read-only tier one panel on the facility overview.
 *
 * No colour anywhere, including on the census comparison. The two census
 * numbers measure different moments and neither is authoritative over the
 * other; a red number would be the panel deciding that for the operator.
 */
export function FacilityDataHealthPanel({
  health,
  error,
}: {
  health: FacilityDataHealth | null;
  error?: string | null;
}) {
  if (error || !health) {
    return (
      <section aria-labelledby="data-health-heading" className="space-y-2">
        <h2 id="data-health-heading" className="text-sm font-medium text-foreground">
          Data health
        </h2>
        <p className="text-sm text-muted-foreground">
          These counts are not available right now. Try again in a moment.
        </p>
      </section>
    );
  }

  const counts = dataHealthCounts(health);

  return (
    <section aria-labelledby="data-health-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="data-health-heading" className="text-sm font-medium text-foreground">
          Data health
        </h2>
        <p className="max-w-prose text-[13px] text-muted-foreground">
          What is still inconsistent in this facility&rsquo;s data, counted live. Correct each one in the
          flow that owns it.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {counts.map((entry) => (
          <div key={entry.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-muted-foreground">
              <Link href={entry.href} className="underline underline-offset-4" title={entry.meaning}>
                {entry.label}
              </Link>
            </dt>
            <dd className="text-[13px] tabular-nums text-foreground" data-testid={`data-health-${entry.key}`}>
              {entry.count}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-1">
        <p className="text-[13px] text-foreground" data-testid="data-health-census">
          {censusComparisonLine(health, formatStandUpWeek)}
        </p>
        <p className="max-w-prose text-xs text-muted-foreground">
          These two count different moments. A difference is worth a conversation, not a correction on its own.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[13px] text-muted-foreground">Last board check</dt>
          <dd className="text-[13px] text-foreground" data-testid="data-health-last-board-check">
            {lastCheckLine(health.last_board_check_closed_at, formatFacilityTimestampEt)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[13px] text-muted-foreground">Last staff check</dt>
          <dd className="text-[13px] text-foreground" data-testid="data-health-last-staff-check">
            {lastCheckLine(health.last_staff_check_closed_at, formatFacilityTimestampEt)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default FacilityDataHealthPanel;
