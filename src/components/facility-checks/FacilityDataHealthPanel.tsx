"use client";

import Link from "next/link";

import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  censusComparisonLine,
  dataHealthCountsByScope,
  DATA_HEALTH_SCOPE_LABELS,
  formatStandUpWeek,
  lastCheckLine,
  type DataHealthCount,
  type FacilityDataHealth,
  type FacilityDataHealthError,
} from "@/lib/facility-checks/data-health";
import { CensusDisagreementChips } from "@/components/stand-up/CensusDisagreementChip";

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
  facilityId,
}: {
  health: FacilityDataHealth | null;
  error?: FacilityDataHealthError | null;
  /** COL-555: shows the census disagreement chip for this facility when there is one. */
  facilityId?: string | null;
}) {
  if (error || !health) {
    return (
      <section aria-labelledby="data-health-heading" className="space-y-2">
        <h2 id="data-health-heading" className="text-sm font-medium text-foreground">
          Data health
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="data-health-unavailable">
          {/* COL-442: "you are not scoped to this facility" is not "try again in
              a moment", and it must never be mistaken for a clean panel. */}
          {error === "forbidden"
            ? "You do not have access to this facility, so there are no counts to show. This is not a statement that its data is clean."
            : "These counts are not available right now. Try again in a moment."}
        </p>
      </section>
    );
  }

  const facilityCounts = dataHealthCountsByScope(health, "facility");
  const allFacilitiesCounts = dataHealthCountsByScope(health, "all_facilities");

  return (
    <section aria-labelledby="data-health-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="data-health-heading" className="text-sm font-medium text-foreground">
          Data health
        </h2>
        <p className="max-w-prose text-[13px] text-muted-foreground">
          What is still inconsistent, counted live. Correct each one in the flow that owns it.
        </p>
      </div>

      <CountGroup
        scopeKey="facility"
        counts={facilityCounts}
        description="Beds, residents and staff at this facility."
      />

      <CountGroup
        scopeKey="all_facilities"
        counts={allFacilitiesCounts}
        description="Counted across every facility, not only this one. An account with no grant belongs to no facility, and duplicates are matched organization-wide, so these two numbers move when another building changes."
      />

      <div className="space-y-1">
        <p className="text-[13px] text-foreground" data-testid="data-health-census">
          {censusComparisonLine(health, formatStandUpWeek)}
        </p>
        {facilityId ? <CensusDisagreementChips facilityId={facilityId} /> : null}
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

/**
 * One scope's counts under its own heading. The heading is what stops an
 * organization-wide number from reading as a fact about this building (COL-438).
 */
function CountGroup({
  scopeKey,
  counts,
  description,
}: {
  scopeKey: keyof typeof DATA_HEALTH_SCOPE_LABELS;
  counts: DataHealthCount[];
  description: string;
}) {
  if (counts.length === 0) return null;
  const headingId = `data-health-scope-${scopeKey}`;

  return (
    <div className="space-y-2" data-testid={`data-health-group-${scopeKey}`}>
      <div className="space-y-0.5">
        <h3 id={headingId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {DATA_HEALTH_SCOPE_LABELS[scopeKey]}
        </h3>
        <p className="max-w-prose text-xs text-muted-foreground">{description}</p>
      </div>
      <dl aria-labelledby={headingId} className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
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
    </div>
  );
}

export default FacilityDataHealthPanel;
