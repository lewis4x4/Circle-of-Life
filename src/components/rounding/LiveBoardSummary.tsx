"use client";

/**
 * The Live board's facility level counts and its filters.
 *
 * Every number here is about the building, never about a resident: spec
 * decision D5 puts resident level numbers out of the module entirely, and this
 * strip is where the numbers that survive belong.
 *
 * "Escalated" is a filter on this strip rather than a tab, which is the whole
 * of defect 9's Escalations collapse. The roster count is on the strip because
 * acceptance item 12 is a claim about it, and a number an operator can see is a
 * number an operator can dispute.
 */

import { FilterPill } from "@/components/ui/filter-pill";
import { MetricCard } from "@/components/ui/metric-card";
import type { LiveBoardFilter } from "@/lib/rounding/live-board-display-copy";
import type { LiveBoardCounts } from "@/lib/rounding/live-board-state";

const FILTERS: Array<{
  value: LiveBoardFilter;
  label: string;
  tone?: "danger" | "warning";
  count: (counts: LiveBoardCounts) => number;
}> = [
  { value: "all", label: "All", count: (counts) => counts.total },
  { value: "critical", label: "Critical", tone: "danger", count: (counts) => counts.critical },
  { value: "overdue", label: "Overdue", tone: "warning", count: (counts) => counts.overdue },
  { value: "escalated", label: "Escalated", tone: "danger", count: (counts) => counts.escalated },
  { value: "pending", label: "Still due", count: (counts) => counts.pending },
  { value: "completed", label: "Recorded", count: (counts) => counts.completed },
  { value: "late", label: "Recorded late", tone: "warning", count: (counts) => counts.late },
];

export function LiveBoardSummary({
  counts,
  rosterCount,
  filter,
  onFilterChange,
}: {
  counts: LiveBoardCounts;
  rosterCount: number;
  filter: LiveBoardFilter;
  onFilterChange: (next: LiveBoardFilter) => void;
}) {
  return (
    <>
      <section aria-label="Live board counts">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard
            label="Critical"
            value={counts.critical}
            numericValue={counts.critical}
            thresholds={{ type: "critical-count" }}
            hint="Critically overdue or missed checks"
          />
          <MetricCard
            label="Overdue"
            value={counts.overdue}
            numericValue={counts.overdue}
            thresholds={{ type: "overdue-count" }}
            hint="Past the window and its grace"
          />
          <MetricCard
            label="Escalated"
            value={counts.escalated}
            numericValue={counts.escalated}
            thresholds={{ type: "critical-count" }}
            hint="Checks with an escalation nobody has closed"
          />
          <MetricCard
            label="Still due"
            value={counts.pending}
            numericValue={counts.pending}
            thresholds={{ type: "informational" }}
            hint="Inside the window, or not open yet"
          />
          <MetricCard
            label="Residents on the roster"
            value={rosterCount}
            numericValue={rosterCount}
            thresholds={{ type: "informational" }}
            hint="Active residents at this building, the population checks generate for"
          />
        </div>
      </section>

      <section aria-label="Filter the live board">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground">Filter</span>
          <div className="-mx-1 flex flex-1 flex-wrap items-center gap-1.5 px-1">
            {FILTERS.map((entry) => (
              <FilterPill
                key={entry.value}
                label={entry.label}
                count={entry.count(counts)}
                tone={entry.tone}
                active={filter === entry.value}
                onClick={() =>
                  onFilterChange(
                    entry.value !== "all" && filter === entry.value ? "all" : entry.value,
                  )
                }
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
