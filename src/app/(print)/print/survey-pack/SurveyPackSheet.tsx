"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCensusRecord,
  fetchRegister,
  fetchVisitorLog,
  recordSurveyPackPrint,
  type CensusRecordRow,
} from "@/lib/registers/load-register";
import {
  registerEventLabel,
  registerRoomLabel,
  residentStatusLabel,
  type RegisterRow,
} from "@/lib/registers/register";
import {
  easternDayEndIso,
  easternDayStartIso,
  formatCensusMonth,
  formatRegisterEventTime,
  formatSurveyPackFooter,
} from "@/lib/registers/register-display-copy";
import {
  SURVEY_PACK_AUDIT_FAILURE_COPY,
  formatSurveyPackRange,
  parseSurveyPackRequest,
  surveyPackSectionLabel,
} from "@/lib/registers/survey-pack";
import { visitorTypeLabel, type VisitorLogRow } from "@/lib/registers/visitor-log";

import styles from "./survey-pack-print.module.css";

type Props = {
  organizationId: string;
  facilityId: string;
  facilityName: string;
  printedByName: string;
};

type Pack = {
  register: RegisterRow[];
  census: CensusRecordRow[];
  visitors: VisitorLogRow[];
};

/**
 * The pack is not rendered until the print has been recorded. A pack handed to
 * a surveyor with no audit row is a pack nobody can account for later, so the
 * order here is deliberate: record first, then fetch, then show.
 */
export function SurveyPackSheet({ organizationId, facilityId, facilityName, printedByName }: Props) {
  const searchParams = useSearchParams();
  const request = useMemo(
    () => parseSurveyPackRequest(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const started = useRef(false);
  const printedAt = useRef(new Date());

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function build() {
      const supabase = createClient();
      try {
        await recordSurveyPackPrint(supabase, {
          facilityId,
          sections: request.sections,
          from: request.from,
          to: request.to,
        });
      } catch {
        if (!cancelled) {
          setError(SURVEY_PACK_AUDIT_FAILURE_COPY);
          setLoading(false);
        }
        return;
      }

      try {
        const from = easternDayStartIso(request.from);
        const to = easternDayEndIso(request.to);
        const [register, census, visitors] = await Promise.all([
          request.sections.includes("register")
            ? fetchRegister(supabase, {
                organizationId,
                facilityId,
                from,
                to,
                includeHolds: request.includeHolds,
              })
            : Promise.resolve([] as RegisterRow[]),
          request.sections.includes("census")
            ? fetchCensusRecord(supabase, {
                organizationId,
                facilityId,
                from: request.from,
                to: request.to,
              })
            : Promise.resolve([] as CensusRecordRow[]),
          request.sections.includes("visitors")
            ? fetchVisitorLog(supabase, {
                organizationId,
                facilityId,
                from,
                to,
                includeVoided: false,
              })
            : Promise.resolve([] as VisitorLogRow[]),
        ]);
        if (!cancelled) setPack({ register, census, visitors });
      } catch {
        if (!cancelled) setError("The pack could not be built.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void build();
    return () => {
      cancelled = true;
    };
  }, [facilityId, organizationId, request]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" aria-hidden />
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700" role="alert">
          {error ?? SURVEY_PACK_AUDIT_FAILURE_COPY}
        </p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const range = formatSurveyPackRange(request.from, request.to);
  const stamp = `${formatSurveyPackFooter({ printedByName, printedAt: printedAt.current, facilityName })} · ${facilityName}`;

  return (
    <>
      <div className={styles.controls}>
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
        <p className="mt-2 text-xs text-neutral-600">
          Choose &ldquo;Save as PDF&rdquo; in the print dialog for a file. Leave headers and footers on
          so each page is numbered.
        </p>
      </div>

      <article className={styles.sheet}>
        {request.sections.includes("register") ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{surveyPackSectionLabel("register")}</h2>
            <p className={styles.sectionMeta}>
              {facilityName} · {range}
              {request.includeHolds ? " · including bed holds" : " · admissions and discharges only"}
            </p>
            {pack.register.length === 0 ? (
              <p className={styles.empty}>No admissions or discharges recorded in Haven for this range.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Date and time</th>
                    <th scope="col">Event</th>
                    <th scope="col">Resident</th>
                    <th scope="col">Room</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.register.map((row) => (
                    <tr key={`${row.residentId}-${row.eventAt}-${row.eventType}`}>
                      <td>{formatRegisterEventTime(row.eventAt)}</td>
                      <td>{registerEventLabel(row.eventType)}</td>
                      <td>{row.residentDisplayName}</td>
                      <td>{registerRoomLabel(row)}</td>
                      <td>{residentStatusLabel(row.fromStatus)}</td>
                      <td>{residentStatusLabel(row.toStatus)}</td>
                      <td>{row.recordedByName ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7}>{stamp}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        ) : null}

        {request.sections.includes("census") ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{surveyPackSectionLabel("census")}</h2>
            <p className={styles.sectionMeta}>
              {facilityName} · {range}
            </p>
            {pack.census.length === 0 ? (
              <p className={styles.empty}>No census recorded in Haven for this range.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Resident</th>
                    <th scope="col">Days physically present</th>
                    <th scope="col">Billable days</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.census.map((row) => (
                    <tr key={`${row.residentId}-${row.month}`}>
                      <td>{formatCensusMonth(row.month)}</td>
                      <td>{row.residentDisplayName}</td>
                      <td>{row.physicalPresenceDays}</td>
                      <td>{row.billableDays}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{stamp}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            <p className={styles.empty}>
              A held bed is billable and not physically present, so the two columns differ whenever a
              resident was at a hospital or away on leave.
            </p>
          </section>
        ) : null}

        {request.sections.includes("visitors") ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{surveyPackSectionLabel("visitors")}</h2>
            <p className={styles.sectionMeta}>
              {facilityName} · {range}
            </p>
            {pack.visitors.length === 0 ? (
              <p className={styles.empty}>No visitors signed in for this range.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Signed in</th>
                    <th scope="col">Visitor</th>
                    <th scope="col">Type</th>
                    <th scope="col">Visiting</th>
                    <th scope="col">Signed out</th>
                    <th scope="col">Signed in by</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.visitors.map((row) => (
                    <tr key={row.id}>
                      <td>{formatRegisterEventTime(row.signedInAt)}</td>
                      <td>{row.visitorName}</td>
                      <td>{visitorTypeLabel(row.visitorType)}</td>
                      <td>{row.visitingResidentName ?? row.visitingType ?? ""}</td>
                      <td>{row.signedOutAt ? formatRegisterEventTime(row.signedOutAt) : ""}</td>
                      <td>{row.signedInByName ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>{stamp}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        ) : null}

        <p className={styles.footer}>{stamp}</p>
      </article>
    </>
  );
}
