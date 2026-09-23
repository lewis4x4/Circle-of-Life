"use client";

/**
 * One cut of the observation report, as a table.
 *
 * Split out of the reports page so both stay inside the constitution's
 * component budget. The group labels arrive already resolved: shift labels come
 * from `facility_shift_definitions` rows through the compliance route, never
 * from `shift_assignments.shift_type`, which is the roster enum and still
 * carries `evening` for other modules.
 */

import {
  complianceRate,
  formatComplianceRate,
  onTimeRate,
  type ComplianceSummary,
} from "@/lib/rounding/observation-compliance-summary";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

export function ReportBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: ComplianceSummary["byShift"];
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border bg-muted/40 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          No expected windows in this range for this cut.
        </p>
      ) : (
        <div>
          <HorizontalScroll label="Observation breakdown">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-border text-[12px] font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Group
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Expected
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Recorded
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    On time
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Late
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Unconfigured
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-2 font-medium text-foreground">{row.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {row.expected}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {formatComplianceRate(complianceRate(row))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {formatComplianceRate(onTimeRate(row))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">{row.late}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {row.unconfigured}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScroll>
        </div>
      )}
    </section>
  );
}
