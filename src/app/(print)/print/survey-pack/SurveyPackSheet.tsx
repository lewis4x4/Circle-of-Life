"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCensusRecord,
  fetchRegister,
  fetchRoomCensus,
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
  formatRegisterEnteredNote,
  formatRegisterEventTime,
  formatSurveyPackFooter,
} from "@/lib/registers/register-display-copy";
import {
  SURVEY_PACK_AUDIT_FAILURE_COPY,
  formatSurveyPackRange,
  parseSurveyPackRequest,
  surveyPackSectionLabel,
} from "@/lib/registers/survey-pack";
import {
  signedInByDisplay,
  visitingDisplay,
  visitorDisplayName,
  visitorTypeLabel,
  type VisitorLogRow,
} from "@/lib/registers/visitor-log";
import { roomCensusSummary, type RoomCensus } from "@/lib/registers/room-census";

import styles from "./survey-pack-print.module.css";

type Props = {
  organizationId: string;
  facilityId: string;
  facilityName: string;
  printedByName: string;
};

type Pack = {
  roomCensus: RoomCensus | null;
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
  const printedAt = useRef(new Date());

  // One build per distinct request, held in a ref rather than behind a "have I
  // started" boolean. React runs an effect, cleans it up and runs it again in
  // development; a boolean guard would skip the second run while the first
  // run's cleanup had already disowned its own results, leaving the sheet on
  // its spinner forever. Re-subscribing to the same promise fixes that and
  // keeps the audit write to exactly one per request.
  const requestKey = `${facilityId}|${request.from}|${request.to}|${request.sections.join(",")}|${request.includeHolds ? 1 : 0}`;
  const buildKey = useRef<string | null>(null);
  const buildRun = useRef<Promise<{ pack: Pack | null; error: string | null }> | null>(null);

  useEffect(() => {
    let active = true;

    async function build(): Promise<{ pack: Pack | null; error: string | null }> {
      const supabase = createClient();
      try {
        await recordSurveyPackPrint(supabase, {
          facilityId,
          sections: request.sections,
          from: request.from,
          to: request.to,
        });
      } catch {
        return { pack: null, error: SURVEY_PACK_AUDIT_FAILURE_COPY };
      }

      try {
        const from = easternDayStartIso(request.from);
        const to = easternDayEndIso(request.to);
        const [roomCensus, register, census, visitors] = await Promise.all([
          request.sections.includes("room_census")
            ? fetchRoomCensus(supabase, { organizationId, facilityId })
            : Promise.resolve(null),
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
        return { pack: { roomCensus, register, census, visitors }, error: null };
      } catch {
        return { pack: null, error: "The pack could not be built." };
      }
    }

    if (buildKey.current !== requestKey) {
      buildKey.current = requestKey;
      buildRun.current = build();
      // A different range is a different pack: never show the last one's rows
      // under this one's heading.
      setPack(null);
      setError(null);
      setLoading(true);
    }

    void buildRun.current?.then((result) => {
      if (!active) return;
      setPack(result.pack);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [facilityId, organizationId, request, requestKey]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
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
        {request.sections.includes("room_census") && pack.roomCensus ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{surveyPackSectionLabel("room_census")}</h2>
            <p className={styles.sectionMeta}>
              {facilityName} · as of {formatRegisterEventTime(printedAt.current.toISOString())} · {roomCensusSummary(pack.roomCensus)}
            </p>
            {pack.roomCensus.rows.length === 0 ? (
              <p className={styles.empty}>No residents are holding a bed in Haven for this facility.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Room</th>
                    <th scope="col">Bed</th>
                    <th scope="col">Resident</th>
                    <th scope="col">Where now</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.roomCensus.rows.map((row) => (
                    <tr key={row.residentId}>
                      <td>{row.room || "Not recorded"}</td>
                      <td>{row.bed}</td>
                      <td>{row.name}</td>
                      <td>{row.place}</td>
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
          </section>
        ) : null}

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
                      <td>
                        {row.recordedByName ?? ""}
                        {formatRegisterEnteredNote(row) ? <div>{formatRegisterEnteredNote(row)}</div> : null}
                      </td>
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
                      <td>{visitorDisplayName(row)}</td>
                      <td>{visitorTypeLabel(row.visitorType)}</td>
                      <td>{visitingDisplay(row)}</td>
                      <td>{row.signedOutAt ? formatRegisterEventTime(row.signedOutAt) : ""}</td>
                      <td>{signedInByDisplay(row)}</td>
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
