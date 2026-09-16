"use client";

import {
  INCIDENT_REPORTS_LOG_COLUMNS,
  printDate,
  printShift,
  printTick,
} from "@/lib/care-events/print";
import type { IncidentReportsLogRow, PrintFacility } from "@/lib/care-events/print-data";

import { PrintSheet } from "./PrintSheet";

export type IncidentReportsLogSheetProps = {
  facility: PrintFacility;
  rows: IncidentReportsLogRow[];
  from: string;
  to: string;
};

/**
 * The Incident Reports Log in the paper log's column order (spec 07A §6.2,
 * Appendix A), so a surveyor is handed a familiar artefact. The order comes
 * from INCIDENT_REPORTS_LOG_COLUMNS, which is the log's order, not the view's.
 */
export function IncidentReportsLogSheet({ facility, rows, from, to }: IncidentReportsLogSheetProps) {
  const tz = facility.timeZone;

  function cell(row: IncidentReportsLogRow, key: (typeof INCIDENT_REPORTS_LOG_COLUMNS)[number]["key"]): string {
    switch (key) {
      case "log_date":
        return printDate(row.logDate, tz);
      case "room":
        return row.room ?? "";
      case "resident":
        return row.resident ?? "";
      case "fall":
        return printTick(row.fall);
      case "bruise":
        return printTick(row.bruise);
      case "scrapes_or_burn":
        return printTick(row.scrapesOrBurn);
      case "cut_laceration_puncture":
        return printTick(row.cutLacerationPuncture);
      case "non_apparent":
        return printTick(row.nonApparent);
      case "other":
        return printTick(row.other);
      case "contributing_factors":
        return row.contributingFactors ?? "";
      case "shift":
        return printShift(row.shift);
    }
  }

  return (
    <PrintSheet title="Incident Reports Log" facilityName={facility.name} timeZone={tz}>
      <p className="print-section mb-3 text-sm">
        {printDate(from, tz)} to {printDate(to, tz)} · {rows.length} {rows.length === 1 ? "entry" : "entries"}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm">No incidents were recorded in this range.</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-black text-left">
              {INCIDENT_REPORTS_LOG_COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="py-1 pr-2 align-bottom font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.incidentId} className="border-b border-neutral-400 align-top">
                {INCIDENT_REPORTS_LOG_COLUMNS.map((column) => (
                  <td key={column.key} className="py-1 pr-2">
                    {cell(row, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PrintSheet>
  );
}
