"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Button } from "@/components/ui/button";
import { standUpRequest } from "@/components/stand-up/transport";
import type { StandUpWorkspaceData } from "@/components/stand-up/types";
import { buildStandUpPrint } from "@/lib/stand-up/print-sheet";
import { easternStamp } from "@/lib/stand-up/model";

import styles from "./stand-up-print.module.css";

/**
 * One building's Weekly Stand Up, printed for the binder. Reads the same
 * authorized Stand Up command as the entry page, so a facility the viewer has
 * no grant for prints nothing.
 */
export function StandUpPrintSheet({ printedByName }: { printedByName: string }) {
  const params = useSearchParams();
  const facilityId = params.get("facility") ?? "";
  const week = params.get("week") ?? "";
  const [data, setData] = useState<StandUpWorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    let active = true;
    standUpRequest<StandUpWorkspaceData>("workspace")
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "The report could not be read."); });
    return () => { active = false; };
  }, []);

  const sheet = useMemo(() => {
    if (!data) return null;
    const facility = data.facilities.find((item) => item.id === facilityId);
    if (!facility || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return undefined;
    const report = data.reports.find((item) => item.facility_id === facilityId && item.week_start === week);
    const prior = data.reports.filter((item) => item.facility_id === facilityId && item.week_start < week).sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
    return buildStandUpPrint({ facilityName: facility.name, week, report, prior });
  }, [data, facilityId, week]);

  if (error) return <p role="alert" className="p-6 text-sm">{error}</p>;
  if (!data) return <p role="status" className="p-6 text-sm">Loading the report…</p>;
  if (!sheet) return <p role="alert" className="p-6 text-sm">Open the printout from the Stand Up page of a building you can enter.</p>;

  return (
    <article className={styles.sheet} aria-label={`${sheet.title}, ${sheet.facility}`}>
      <div className={styles.actions}>
        <Button type="button" onClick={() => window.print()}>Print</Button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>{sheet.title} · {sheet.facility}</h1>
        <p className={styles.meta}>{sheet.week}</p>
        <p className={styles.meta}>{sheet.state} · {sheet.evidence}</p>
      </header>
      {sheet.sections.map((section) => (
        <section key={section.key} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.label}</h2>
          <p className={styles.period}>{section.period}</p>
          <HorizontalScroll label={`${section.label} report figures`} className={styles.scroll} viewportClassName={styles.tableViewport}>
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">Figure</th><th scope="col" className={styles.num}>This report</th><th scope="col" className={styles.num}>Previous report</th><th scope="col">Checked against Haven</th></tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}<div className={styles.definition}>{row.definition}</div></td>
                  <td className={styles.num}>{row.value}</td>
                  <td className={styles.num}>{row.previous ?? "—"}</td>
                  <td>{row.checked ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </HorizontalScroll>
        </section>
      ))}
      <div className={styles.signoff}>
        <div className={styles.line}>Administrator signature</div>
        <div className={styles.line}>Date</div>
      </div>
      <p className={styles.footer}>Printed by {printedByName} on {easternStamp(printedAt)}. The Haven record is the original; this copy is for the binder.</p>
    </article>
  );
}
