/**
 * The compliance export. Spec 25A section 7.4's survey artifact, for windows.
 *
 * One row per cut group per bucket, so the file an administrator hands to a
 * surveyor carries the same numbers the screen showed and nothing the screen
 * did not. There is no resident row in it: decision D5 keeps resident level
 * numbers out of the module, and an export is still part of the module.
 *
 * `unconfigured` is a column of its own rather than folded into the rate,
 * because a window whose cadence never resolved is a configuration gap and a
 * surveyor is entitled to see it named as one.
 */

import type { ComplianceSummary } from "@/lib/rounding/observation-compliance-summary";

const HEADER = [
  "cut",
  "group",
  "expected",
  "recorded",
  "unconfigured",
  "absorbed",
  "scheduled_checks",
  "on_time",
  "late",
] as const;

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildComplianceReportCsv(summary: ComplianceSummary): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [[...HEADER]];
  const cuts: Array<[string, ComplianceSummary["byShift"]]> = [
    ["shift", summary.byShift],
    ["hall", summary.byHall],
    ["staff", summary.byStaff],
  ];
  for (const [cut, entries] of cuts) {
    for (const entry of entries) {
      rows.push([
        cut,
        entry.label,
        entry.expected,
        entry.satisfied,
        entry.unconfigured,
        entry.absorbed,
        entry.withTask,
        entry.onTime,
        entry.late,
      ]);
    }
  }
  rows.push([
    "total",
    `${summary.from} to ${summary.to}`,
    summary.totals.expected,
    summary.totals.satisfied,
    summary.totals.unconfigured,
    summary.totals.absorbed,
    summary.totals.withTask,
    summary.totals.onTime,
    summary.totals.late,
  ]);
  return rows;
}

export function complianceReportCsvText(summary: ComplianceSummary): string {
  return buildComplianceReportCsv(summary)
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

export function downloadComplianceReportCsv(summary: ComplianceSummary): void {
  const blob = new Blob([complianceReportCsvText(summary)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `observation-compliance-${summary.from}-to-${summary.to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
