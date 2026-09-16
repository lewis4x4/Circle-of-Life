"use client";

/**
 * Compare with uPunch (COL-352, spec 37 §9). Upload the uPunch app CSV, map
 * its columns, and see Haven minutes against uPunch minutes per staff member
 * per workweek. The file is parsed in the browser and discarded; nothing from
 * it is stored or sent anywhere.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { computeTimesheet, facilityDayStart, payPeriodContaining, type PayPeriod } from "@/lib/timeclock/compute";
import { TIMECLOCK_MANAGER_ONLY, TIMECLOCK_PICK_FACILITY, formatDayLabel, formatMinutesCompact, formatPeriodLabel } from "@/lib/timeclock/display-copy";
import { canReviewTimeclock, loadEmployeeNumbers, loadOrganizationPayPeriod, loadTimeclockPeriod } from "@/lib/timeclock/load";
import {
  MATCH_TOLERANCE_MINUTES,
  buildComparisonCsv,
  parseCsv,
  reconcileUpunch,
  type ColumnMapping,
  type ComparisonResult,
  type HavenStaffWeeks,
  type HoursFormat,
  type IdentifierKind,
  type ParsedCsv,
} from "@/lib/timeclock/reconcile";
import { cn } from "@/lib/utils";

const FIELD = "mt-1 block h-9 w-full rounded-[8px] border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const LABEL = "text-xs font-medium text-muted-foreground";
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 text-sm";

export type UpunchCompareProps = {
  now?: () => Date;
  /** Test hook: supply CSV text instead of reading a File. */
  readFile?: (file: File) => Promise<string>;
};

function guessColumn(headers: string[], candidates: RegExp[]): string {
  for (const re of candidates) {
    const hit = headers.find((h) => re.test(h));
    if (hit) return hit;
  }
  return headers[0] ?? "";
}

export function UpunchCompare({ now: nowProp, readFile }: UpunchCompareProps) {
  const now = useMemo(() => nowProp ?? (() => new Date()), [nowProp]);
  const { appRole, organizationId } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const searchParams = useSearchParams();
  const requestedStart = searchParams?.get("period_start") ?? null;
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const canReview = canReviewTimeclock(appRole);

  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [haven, setHaven] = useState<HavenStaffWeeks[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [mapping, setMapping] = useState<ColumnMapping>({ identifier: "", date: "", hours: "", identifierKind: "employee_number", hoursFormat: "decimal" });
  const [result, setResult] = useState<ComparisonResult | null>(null);

  useEffect(() => {
    if (!organizationId || !canReview) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await loadOrganizationPayPeriod(createClient(), organizationId);
        if (cancelled) return;
        const anchor = requestedStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? facilityDayStart(requestedStart) : now();
        setPeriod(payPeriodContaining(anchor, settings));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the pay period");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, canReview, requestedStart, now]);

  const load = useCallback(async () => {
    if (!facilityId || !period || !canReview) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const data = await loadTimeclockPeriod(supabase, { facilityId, periodStart: period.start, periodEnd: period.end });
      const numbers = await loadEmployeeNumbers(supabase, data.staff.map((s) => s.id));
      const at = now();
      setHaven(
        data.staff.map((s) => ({
          staffId: s.id,
          name: s.name,
          employeeNumber: numbers.get(s.id) ?? null,
          weeks: computeTimesheet({ staffId: s.id, punches: data.punches, corrections: data.corrections, rejections: data.rejections, periodStart: period.start, periodEnd: period.end, now: at }).weeks,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Haven minutes");
      setHaven(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId, period, canReview, now]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    setError(null);
    try {
      const text = readFile ? await readFile(file) : await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        setError("That file has no rows.");
        return;
      }
      setUpload(parsed);
      setFileName(file.name);
      setMapping((m) => ({
        ...m,
        identifier: guessColumn(parsed.headers, [/employee\s*(number|id|#)/i, /badge/i, /name/i]),
        date: guessColumn(parsed.headers, [/date/i, /day/i]),
        hours: guessColumn(parsed.headers, [/total/i, /hours/i, /time/i]),
      }));
    } catch {
      setError("Could not read that file.");
    } finally {
      event.target.value = "";
    }
  };

  const compare = () => {
    if (!upload || !haven) return;
    setResult(reconcileUpunch({ upload, mapping, haven }));
  };

  const download = () => {
    if (!result || !period) return;
    triggerCsvDownload(`haven-upunch-comparison-${period.startIso}.csv`, buildComparisonCsv(result));
  };

  if (!canReview) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Compare with uPunch</h1>
        <p className="text-sm text-muted-foreground">{TIMECLOCK_MANAGER_ONLY}</p>
      </div>
    );
  }

  const matched = result?.rows.filter((r) => r.match).length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link href={`/admin/timeclock${period ? `?period_start=${period.startIso}` : ""}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Timeclock
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Compare with uPunch</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the CSV exported from the uPunch app for {period ? formatPeriodLabel(period.startIso, period.endIso) : "this period"}. It is read in this browser and not kept.
        </p>
      </header>

      {error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}

      {!facilityId ? (
        <AdminEmptyState title={TIMECLOCK_PICK_FACILITY} description="Use the facility selector in the top bar." />
      ) : loading || !haven ? (
        <AdminTableLoadingState />
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="text-sm font-semibold">
              uPunch export
            </h2>
            <div>
              <label htmlFor="upunch-file" className={LABEL}>
                CSV file
              </label>
              <input id="upunch-file" type="file" accept=".csv,text/csv" className="mt-1 block text-sm" onChange={(e) => void onFile(e)} />
              {fileName ? <p className="mt-1 text-xs text-muted-foreground">{fileName}, {upload?.rows.length ?? 0} rows</p> : null}
            </div>
            {upload ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label htmlFor="map-identifier" className={LABEL}>
                    Employee column
                  </label>
                  <select id="map-identifier" className={FIELD} value={mapping.identifier} onChange={(e) => setMapping((m) => ({ ...m, identifier: e.target.value }))}>
                    {upload.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="map-identifier-kind" className={LABEL}>
                    That column holds
                  </label>
                  <select id="map-identifier-kind" className={FIELD} value={mapping.identifierKind} onChange={(e) => setMapping((m) => ({ ...m, identifierKind: e.target.value as IdentifierKind }))}>
                    <option value="employee_number">Employee number</option>
                    <option value="name">Name</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="map-date" className={LABEL}>
                    Date column
                  </label>
                  <select id="map-date" className={FIELD} value={mapping.date} onChange={(e) => setMapping((m) => ({ ...m, date: e.target.value }))}>
                    {upload.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="map-hours" className={LABEL}>
                    Hours column
                  </label>
                  <select id="map-hours" className={FIELD} value={mapping.hours} onChange={(e) => setMapping((m) => ({ ...m, hours: e.target.value }))}>
                    {upload.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="map-hours-format" className={LABEL}>
                    Hours format
                  </label>
                  <select id="map-hours-format" className={FIELD} value={mapping.hoursFormat} onChange={(e) => setMapping((m) => ({ ...m, hoursFormat: e.target.value as HoursFormat }))}>
                    <option value="decimal">Decimal hours (7.50)</option>
                    <option value="hmm">Hours and minutes (7:30)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="button" size="sm" onClick={compare}>
                    Compare
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {result ? (
            <section className="space-y-3" aria-labelledby="result-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="result-heading" className="text-sm font-semibold">
                  {matched} of {result.rows.length} staff weeks match within {MATCH_TOLERANCE_MINUTES} minutes
                  {result.unmatched.length > 0 ? `, ${result.unmatched.length} uploaded employee${result.unmatched.length === 1 ? "" : "s"} not found in Haven` : ""}
                  {result.skipped > 0 ? `, ${result.skipped} unreadable row${result.skipped === 1 ? "" : "s"} skipped` : ""}
                </h2>
                <Button type="button" size="sm" variant="outline" onClick={download}>
                  Download comparison CSV
                </Button>
              </div>
              {result.rows.length === 0 ? (
                <AdminEmptyState title="Nothing to compare" description="No uploaded rows matched a Haven staff member in this period." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full">
                    <caption className="sr-only">Haven versus uPunch minutes per staff member per workweek</caption>
                    <thead className="bg-muted/40">
                      <tr>
                        <th scope="col" className={TH}>Staff</th>
                        <th scope="col" className={TH}>Workweek</th>
                        <th scope="col" className={cn(TH, "text-right")}>Haven</th>
                        <th scope="col" className={cn(TH, "text-right")}>uPunch</th>
                        <th scope="col" className={cn(TH, "text-right")}>Difference</th>
                        <th scope="col" className={TH}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => (
                        <tr key={`${row.staffId}-${row.workweekStart}`} className="border-t border-border">
                          <td className={TD}>
                            {row.staffName}
                            {row.employeeNumber ? <span className="ml-2 text-xs text-muted-foreground">{row.employeeNumber}</span> : null}
                          </td>
                          <td className={TD}>{formatDayLabel(row.workweekStart)}</td>
                          <td className={cn(TD, "text-right tabular-nums")}>{formatMinutesCompact(row.havenMinutes)}</td>
                          <td className={cn(TD, "text-right tabular-nums")}>{formatMinutesCompact(row.upunchMinutes)}</td>
                          <td className={cn(TD, "text-right tabular-nums")}>
                            {row.differenceMinutes > 0 ? "+" : ""}
                            {row.differenceMinutes} min
                          </td>
                          <td className={TD}>{row.match ? "Match" : "Differs"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.unmatched.length > 0 ? (
                <ul className="text-sm text-muted-foreground" aria-label="Uploaded employees not found in Haven">
                  {result.unmatched.map((u) => (
                    <li key={u.identifier}>
                      {u.identifier}: {u.rows} row{u.rows === 1 ? "" : "s"}, {formatMinutesCompact(u.minutes)} in uPunch, no Haven match
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
