"use client";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { BackLink } from "@/design-system/components/BackLink";
import { buildScreeningSheet, type ScreeningSheetFacts } from "@/lib/benefits/screening-sheet";
import { BenefitsRequestError, benefitsFetch, ErrorNotice } from "./benefits-ui";

/** COL-770: printable DOEA 701S sheet. Pre-filled answers show their source; everything else is left blank on purpose. */
export function ScreeningSheet701S({ caseId }: { caseId: string }) {
  const [facts, setFacts] = useState<ScreeningSheetFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    benefitsFetch<ScreeningSheetFacts>(`/api/admin/benefits/cases/${caseId}/701s`)
      .then((body) => { if (active) setFacts(body); })
      .catch((e) => { if (active) setError(e instanceof BenefitsRequestError && (e.status === 403 || e.status === 404) ? "The screening sheet is available to staff with Medicaid access for this facility." : e instanceof Error ? e.message : "Unable to load the screening sheet."); });
    return () => { active = false; };
  }, [caseId]);
  const sections = useMemo(() => (facts ? buildScreeningSheet(facts) : null), [facts]);
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24 print:max-w-none print:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink label="Medicaid case" href={`/admin/benefits/${caseId}`} />
        {sections && <Button className="min-h-11" onClick={() => window.print()}>Print</Button>}
      </div>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">DOEA 701S screening sheet (telephone)</h1>
        <p className="text-sm text-muted-foreground">
          Pre-filled only from this resident&apos;s record, with the source beside each answer. Blank answers are blank on purpose: ask, and answer truthfully for this resident. Haven supplies no default answers.
        </p>
      </header>
      <ErrorNotice error={error} />
      {!sections && !error && <p role="status">Loading the screening sheet…</p>}
      {sections?.map((section) => (
        <section key={section.title} className="break-inside-avoid space-y-1">
          <h2 className="border-b border-border pb-1 text-base font-semibold">{section.title}</h2>
          <HorizontalScroll label={section.title}>
          <table className="w-full text-sm">
            <tbody>
              {section.items.map((item, index) => (
                <tr key={`${item.q}-${index}`} className="border-b border-border/60 align-top">
                  <th scope="row" className="w-14 py-1.5 pr-2 text-left font-medium tabular-nums">{item.q}</th>
                  <td className="py-1.5 pr-3">{item.label}</td>
                  <td className="w-2/5 py-1.5">
                    {item.answer ? (
                      <>
                        <span className="font-medium">{item.answer}</span>
                        <span className="block text-xs text-muted-foreground">Source: {item.source}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground" aria-label="Blank: ask">____________</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </HorizontalScroll>
        </section>
      ))}
    </div>
  );
}
