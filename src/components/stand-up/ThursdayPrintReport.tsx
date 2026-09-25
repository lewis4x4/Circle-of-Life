"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { dateLabel } from "@/lib/stand-up/model";
import { MEETING_LABELS, THURSDAY_FIGURES, mondayComparison, thursdayDisplay, type MeetingWorkspace, type MondaySubmitted } from "@/lib/stand-up/meetings";
import { reportFigureLine, reportStamp, type FacilityReport, type ThursdayReport } from "@/lib/stand-up/thursday-report";
import { standUpRequest } from "./transport";
import { ThursdayReportSections } from "./ThursdayReportSections";

type Loaded = { report: ThursdayReport; workspace: MeetingWorkspace };

/**
 * COL-754: the printable Thursday report. Per facility, in order: the figures
 * the administrator submitted beside Monday's and Haven's, then who left and who
 * is away, the potential residents with every note and contact, and the
 * recruiters' activity since Monday. Recruiters print it read-only.
 */
export function ThursdayPrintReport({ facilityId, week }: { facilityId: string | null; week: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([
      standUpRequest<ThursdayReport>("report", { meeting_day: "thursday", ...(facilityId ? { facility_id: facilityId } : {}), ...(week ? { week_start: week } : {}) }),
      standUpRequest<MeetingWorkspace>("workspace", { meeting_day: "thursday" }),
    ]).then(([report, workspace]) => { if (live) setLoaded({ report, workspace }); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "The report could not be read."); });
    return () => { live = false; };
  }, [facilityId, week]);

  if (error) return <p role="alert" className="p-6">{error}</p>;
  if (!loaded) return <p role="status" className="p-6">Loading the report…</p>;
  const { report, workspace } = loaded;
  return <div className="mx-auto max-w-4xl space-y-8 p-6 text-sm print:p-0">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{MEETING_LABELS.thursday} Stand Up</h1>
        <p className="text-muted-foreground">Printed {reportStamp(report.generated_at)} Eastern</p>
      </div>
      <Button className="print:hidden" onClick={() => window.print()}>Print</Button>
    </header>
    {!report.facilities.length && <p>No facility report to print.</p>}
    {report.facilities.map((facility) => <FacilityPrint key={facility.facility_id} facility={facility} workspace={workspace} />)}
  </div>;
}

function FacilityPrint({ facility, workspace }: { facility: FacilityReport; workspace: MeetingWorkspace }) {
  const saved = workspace.reports.find((item) => item.facility_id === facility.facility_id && item.week_start === facility.week_start);
  const monday: MondaySubmitted = saved?.monday_submitted
    ?? workspace.monday_baselines.find((item) => item.facility_id === facility.facility_id && item.week_start === facility.week_start)?.monday_submitted
    ?? null;
  const submitted = saved && saved.status === "ready";
  return <section aria-label={facility.facility_name} className="space-y-4 break-before-page first:break-before-auto">
    <div>
      <h2 className="text-lg font-semibold">{facility.facility_name}</h2>
      <p className="text-muted-foreground">Week of {dateLabel(facility.week_start)} · {submitted ? "Figures submitted by the administrator" : saved ? "Figures saved as a draft, not submitted" : "Figures not entered yet"}</p>
    </div>
    <HorizontalScroll label={`${facility.facility_name} Thursday figures`}>
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">{facility.facility_name} Thursday figures beside Monday&rsquo;s submitted figures</caption>
      <thead><tr className="border-b border-border"><th scope="col" className="py-1 pr-3 font-medium">Figure</th><th scope="col" className="py-1 pr-3 font-medium">Thursday</th><th scope="col" className="py-1 pr-3 font-medium">Monday submitted</th><th scope="col" className="py-1 pr-3 font-medium">Change</th></tr></thead>
      <tbody>{THURSDAY_FIGURES.map((figure) => {
        const value = saved?.values[figure.key] ?? null;
        const comparison = mondayComparison(figure.key, value, monday);
        const haven = reportFigureLine(facility, figure.key, (n) => thursdayDisplay(figure.key, n));
        return <tr key={figure.key} className="border-b border-border align-top">
          <th scope="row" className="py-1 pr-3 font-medium">{figure.label}{haven && <span className="block text-xs font-normal text-muted-foreground">{haven}</span>}</th>
          <td className="py-1 pr-3 tabular-nums">{saved ? thursdayDisplay(figure.key, value) : "Not entered"}</td>
          <td className="py-1 pr-3 tabular-nums">{comparison.monday}</td>
          <td className="py-1 pr-3 tabular-nums">{comparison.change ?? "—"}</td>
        </tr>;
      })}</tbody>
    </table>
    </HorizontalScroll>
    <ThursdayReportSections report={facility} />
  </section>;
}
