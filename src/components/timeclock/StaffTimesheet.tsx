"use client";

/**
 * Tier 2 and 3 of the timeclock (COL-352, spec 37 §6): one person, one pay
 * period. Days with effective punches, worked and meal minutes, exceptions
 * with Acknowledge, a correction form with a required reason, and a Full
 * history disclosure listing every raw punch and correction with actor and
 * time. Nothing here edits a punch; every change is an appended row.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import {
  WORKWEEK_TZ,
  computeTimesheet,
  facilityDayStart,
  payPeriodContaining,
  shiftPayPeriod,
  type CorrectionReason,
  type PayPeriod,
  type PayPeriodSettings,
  type RawCorrection,
  type RawFloorUnlock,
  type RawPunch,
  type RawSyncRejection,
  type TimesheetException,
} from "@/lib/timeclock/compute";
import {
  CORRECTION_REASON_LABELS,
  CORRECTION_TYPE_LABELS,
  EXCEPTION_LABELS,
  PUNCH_TYPE_LABELS,
  TIMECLOCK_FULL_HISTORY,
  formatDateTime,
  formatDayLabel,
  formatMinutesCompact,
  formatPeriodLabel,
} from "@/lib/timeclock/display-copy";
import { PUNCH_TYPES, formatKioskTime, type PunchType } from "@/lib/timeclock/kiosk-contract";
import { canReviewTimeclock, loadOrganizationPayPeriod, loadStaffTimeclock, type TimeclockStaff } from "@/lib/timeclock/load";
import { PlannedScheduleContext } from "./PlannedScheduleContext";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

const FIELD = "mt-1 block h-9 w-full rounded-[8px] border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const LABEL = "text-xs font-medium text-muted-foreground";

type CorrectionKind = "add_punch" | "void_punch" | "change_time";

type Draft = {
  kind: CorrectionKind;
  target: string;
  punchType: PunchType;
  when: string;
  reason: CorrectionReason | "";
  note: string;
};

const EMPTY_DRAFT: Draft = { kind: "add_punch", target: "", punchType: "in", when: "", reason: "", note: "" };

export type StaffTimesheetProps = {
  staffId: string;
  now?: () => Date;
};

function utcFromEasternLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = fromZonedTime(`${value}:00`, WORKWEEK_TZ);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function StaffTimesheet({ staffId, now: nowProp }: StaffTimesheetProps) {
  const now = useMemo(() => nowProp ?? (() => new Date()), [nowProp]);
  const { appRole, organizationId, user } = useHavenAuth();
  const searchParams = useSearchParams();
  const requestedStart = searchParams?.get("period_start") ?? null;
  const requestedEnd = searchParams?.get("period_end") ?? null;
  const workweekMode = searchParams?.get("period_mode") === "workweek";
  const canReview = canReviewTimeclock(appRole);

  const [settings, setSettings] = useState<PayPeriodSettings | null>(null);
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [staff, setStaff] = useState<TimeclockStaff | null>(null);
  const [punches, setPunches] = useState<RawPunch[]>([]);
  const [corrections, setCorrections] = useState<RawCorrection[]>([]);
  const [rejections, setRejections] = useState<RawSyncRejection[]>([]);
  const [floorUnlocks, setFloorUnlocks] = useState<RawFloorUnlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const correctionTimeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void (async () => {
      try {
        if (workweekMode) {
          if (!requestedStart || !requestedEnd || !/^\d{4}-\d{2}-\d{2}$/.test(requestedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedEnd)) {
            throw new Error("The workweek link must include a Monday start and the following Monday as its end.");
          }
          const week = payPeriodContaining(facilityDayStart(requestedStart), null);
          if (week.startIso !== requestedStart || week.endIso !== requestedEnd) {
            throw new Error("The workweek link must include a Monday start and the following Monday as its end.");
          }
          setSettings(null);
          setPeriod(week);
          return;
        }
        const loaded = await loadOrganizationPayPeriod(createClient(), organizationId);
        if (cancelled) return;
        setSettings(loaded);
        const anchor = requestedStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? facilityDayStart(requestedStart) : now();
        setPeriod(payPeriodContaining(anchor, loaded));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load the pay period");
          setPeriod(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, requestedStart, requestedEnd, workweekMode, now]);

  const load = useCallback(async () => {
    if (!period) return;
    if (!UUID_STRING_RE.test(staffId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadStaffTimeclock(createClient(), { staffId, periodStart: period.start, periodEnd: period.end });
      if (!loaded.staff) {
        setNotFound(true);
        return;
      }
      setStaff(loaded.staff);
      setPunches(loaded.punches);
      setCorrections(loaded.corrections);
      setRejections(loaded.rejections);
      setFloorUnlocks(loaded.floorUnlocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the timesheet");
    } finally {
      setLoading(false);
    }
  }, [staffId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const sheet = useMemo(() => {
    if (!period) return null;
    return computeTimesheet({ staffId, punches, corrections, rejections, floorUnlocks, periodStart: period.start, periodEnd: period.end, now: now() });
  }, [staffId, punches, corrections, rejections, floorUnlocks, period, now]);

  const facilityForTarget = useCallback(
    (target: string): string | null => {
      const punch = punches.find((p) => p.id === target);
      if (punch?.facility_id) return punch.facility_id;
      const correction = corrections.find((c) => c.id === target);
      if (correction?.facility_id) return correction.facility_id;
      const rejection = rejections.find((r) => r.id === target);
      if (rejection?.facility_id) return rejection.facility_id;
      return staff?.facilityId ?? null;
    },
    [punches, corrections, rejections, staff],
  );

  const insertCorrection = useCallback(
    async (row: Record<string, unknown>) => {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("time_punch_corrections").insert(row as never);
      if (insertError) throw new Error(insertError.message);
      await load();
    },
    [load],
  );

  const acknowledge = async (exception: TimesheetException) => {
    if (!user || !organizationId || !staff || (exception.type === "missing_out" || exception.type === "missing_meal_end")) return;
    setFormError(null);
    try {
      await insertCorrection({
        organization_id: organizationId,
        facility_id: facilityForTarget(exception.anchorId) ?? staff.facilityId,
        staff_id: staffId,
        correction_type: "acknowledge",
        exception_key: exception.key,
        reason: "manager_verified_time",
        corrected_by: user.id,
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not acknowledge");
    }
  };

  const addMissingPunch = (exception: TimesheetException) => {
    setFormError(null);
    setDraft({ ...EMPTY_DRAFT, target: exception.anchorId, punchType: exception.type === "missing_meal_end" ? "meal_end" : "out", reason: "missed_punch" });
    correctionTimeRef.current?.focus();
  };

  const submitCorrection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !organizationId || !staff) return;
    setFormError(null);
    if (!draft.reason) {
      setFormError("Choose a reason.");
      return;
    }
    const isCorrectionTarget = draft.target && corrections.some((c) => c.id === draft.target);
    const row: Record<string, unknown> = {
      organization_id: organizationId,
      facility_id: facilityForTarget(draft.target) ?? staff.facilityId,
      staff_id: staffId,
      correction_type: draft.kind,
      reason: draft.reason,
      note: draft.note.trim() ? draft.note.trim().slice(0, 280) : null,
      corrected_by: user.id,
    };
    if (draft.kind === "add_punch") {
      const when = utcFromEasternLocal(draft.when);
      if (!when) {
        setFormError("Enter the punch time.");
        return;
      }
      const missingStart = sheet?.effective.find((punch) => punch.id === draft.target);
      if (missingStart && (draft.punchType === "out" || draft.punchType === "meal_end") && new Date(when) <= missingStart.at) {
        setFormError(draft.punchType === "meal_end" ? "Meal end must be after the meal start." : "Clock out must be after the clock in.");
        return;
      }
      row.punch_type = draft.punchType;
      row.corrected_punched_at = when;
    } else {
      if (!draft.target) {
        setFormError("Choose the punch.");
        return;
      }
      if (isCorrectionTarget) row.target_correction_id = draft.target;
      else row.target_punch_id = draft.target;
      if (draft.kind === "change_time") {
        const when = utcFromEasternLocal(draft.when);
        if (!when) {
          setFormError("Enter the corrected time.");
          return;
        }
        row.corrected_punched_at = when;
      }
    }
    setSaving(true);
    try {
      await insertCorrection(row);
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the correction");
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return <AdminEmptyState title="Staff member not found" description="They may belong to a facility you cannot see." />;
  }

  const periodQuery = period ? `?period_start=${period.startIso}` : "";
  const effectiveTargets = sheet?.effective ?? [];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={workweekMode ? "/admin/timecards" : `/admin/timeclock${periodQuery}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← {workweekMode ? "Timecards" : "Timeclock"}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{staff?.name ?? "Timesheet"}</h1>
          {sheet ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMinutesCompact(sheet.periodWorkedMinutes)} worked, {formatMinutesCompact(sheet.periodMealMinutes)} meal, {formatMinutesCompact(sheet.periodOvertimeMinutes)} overtime this period.
            </p>
          ) : null}
        </div>
        {period ? (
          <div className="flex items-center gap-1" role="group" aria-label={workweekMode ? "Workweek" : "Pay period"}>
            <Button type="button" variant="outline" size="sm" onClick={() => setPeriod(shiftPayPeriod(period, settings, -1))} aria-label="Previous period">
              ←
            </Button>
            <span className="px-2 text-sm tabular-nums" data-testid="period-label">
              {formatPeriodLabel(period.startIso, period.endIso)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPeriod(shiftPayPeriod(period, settings, 1))} aria-label="Next period">
              →
            </Button>
          </div>
        ) : null}
      </header>

      {error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}
      {formError ? (
        <p role="alert" className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {formError}
        </p>
      ) : null}

      {error && !sheet ? null : loading || !sheet ? (
        <AdminTableLoadingState />
      ) : (
        <>
          {period && staff && <PlannedScheduleContext facilityIds={[]} staffId={staffId} from={period.start.toISOString()} to={period.end.toISOString()} />}
          <section aria-labelledby="weeks-heading" className="rounded-xl border border-border bg-card p-4">
            <h2 id="weeks-heading" className="text-sm font-semibold">
              Workweeks
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {sheet.weeks.map((week) => (
                <li key={week.workweekStart} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>Week of {formatDayLabel(week.workweekStart)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMinutesCompact(week.workedMinutes)} worked · {formatMinutesCompact(week.mealMinutes)} meal · {formatMinutesCompact(week.overtimeMinutes)} overtime
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="days-heading" className="space-y-3">
            <h2 id="days-heading" className="text-sm font-semibold">
              Days
            </h2>
            {sheet.days.length === 0 ? (
              <AdminEmptyState title="No punches in this period" description="Punches appear here as they are recorded on an enrolled tablet." />
            ) : (
              sheet.days.map((day) => (
                <article key={day.dateIso} className="rounded-xl border border-border bg-card p-4" aria-label={formatDayLabel(day.dateIso)}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">{formatDayLabel(day.dateIso)}</h3>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatMinutesCompact(day.workedMinutes)} worked · {formatMinutesCompact(day.mealMinutes)} meal
                    </p>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {day.punches.map((p) => (
                      <li key={p.id} className="rounded-[8px] border border-border px-2 py-1 text-sm tabular-nums">
                        {PUNCH_TYPE_LABELS[p.punchType]} {formatKioskTime(p.at)}
                        {p.source === "correction" ? <span className="ml-1 text-xs text-muted-foreground">(added)</span> : null}
                        {p.timeChanged ? <span className="ml-1 text-xs text-muted-foreground">(time changed)</span> : null}
                      </li>
                    ))}
                  </ul>
                  {day.exceptions.length > 0 ? (
                    <ul className="mt-3 space-y-2" aria-label="Exceptions">
                      {day.exceptions.map((exception) => (
                        <li key={exception.key} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                          <span>
                            {EXCEPTION_LABELS[exception.type]} · {formatKioskTime(exception.at)}
                            {exception.acknowledged ? <span className="ml-2 text-xs text-muted-foreground">Acknowledged</span> : null}
                          </span>
                          {canReview && !exception.acknowledged && (exception.type === "missing_out" || exception.type === "missing_meal_end") ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => addMissingPunch(exception)}>
                              {exception.type === "missing_meal_end" ? "Add meal end" : "Add clock out"}
                            </Button>
                          ) : canReview && !exception.acknowledged ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => void acknowledge(exception)}>
                              Acknowledge
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            )}
          </section>

          {canReview ? (
            <form onSubmit={submitCorrection} className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="correction-heading">
              <h2 id="correction-heading" className="text-sm font-semibold">
                Add a correction
              </h2>
              <p className="text-xs text-muted-foreground">Punches are never edited. A correction is a new row with a reason on record.</p>
              {draft.kind === "add_punch" && draft.target ? (
                <p role="status" className="text-sm text-warning">Enter the verified {draft.punchType === "meal_end" ? "meal-end" : "clock-out"} time. Missing hours remain unresolved until the punch is corrected.</p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label htmlFor="correction-kind" className={LABEL}>
                    Correction
                  </label>
                  <select id="correction-kind" className={FIELD} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as CorrectionKind, target: "" }))}>
                    {(Object.keys(CORRECTION_TYPE_LABELS) as CorrectionKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {CORRECTION_TYPE_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.kind === "add_punch" ? (
                  <div>
                    <label htmlFor="correction-punch-type" className={LABEL}>
                      Punch type
                    </label>
                    <select id="correction-punch-type" className={FIELD} value={draft.punchType} onChange={(e) => setDraft((d) => ({ ...d, punchType: e.target.value as PunchType }))}>
                      {PUNCH_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {PUNCH_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="correction-target" className={LABEL}>
                      Punch
                    </label>
                    <select id="correction-target" className={FIELD} value={draft.target} onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))} required>
                      <option value="">Choose a punch</option>
                      {effectiveTargets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {PUNCH_TYPE_LABELS[p.punchType]} {formatDateTime(p.at)}
                          {p.source === "correction" ? " (added)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {draft.kind !== "void_punch" ? (
                  <div>
                    <label htmlFor="correction-when" className={LABEL}>
                      {draft.kind === "add_punch" ? "Punch time (Eastern)" : "Corrected time (Eastern)"}
                    </label>
                    <input ref={correctionTimeRef} id="correction-when" type="datetime-local" className={FIELD} value={draft.when} onChange={(e) => setDraft((d) => ({ ...d, when: e.target.value }))} required />
                  </div>
                ) : null}
                <div>
                  <label htmlFor="correction-reason" className={LABEL}>
                    Reason
                  </label>
                  <select
                    id="correction-reason"
                    className={FIELD}
                    value={draft.reason}
                    onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value as CorrectionReason }))}
                    required
                    aria-invalid={formError === "Choose a reason." ? true : undefined}
                  >
                    <option value="">Choose a reason</option>
                    {(Object.keys(CORRECTION_REASON_LABELS) as CorrectionReason[]).map((reason) => (
                      <option key={reason} value={reason}>
                        {CORRECTION_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="correction-note" className={LABEL}>
                    Note (optional, 280 characters)
                  </label>
                  <input id="correction-note" className={FIELD} maxLength={280} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={saving}>
                Save correction
              </Button>
            </form>
          ) : null}

          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">{TIMECLOCK_FULL_HISTORY}</summary>
            <div className="mt-3">
              <HorizontalScroll label="Timesheet history">
                <table className="w-full text-sm">
                  <caption className="sr-only">Every punch and correction for this person in the loaded window</caption>
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-2 py-1">When</th>
                      <th scope="col" className="px-2 py-1">Entry</th>
                      <th scope="col" className="px-2 py-1">Actor</th>
                      <th scope="col" className="px-2 py-1">Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {punches.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{formatDateTime(p.punched_at)}</td>
                        <td className="px-2 py-1">
                          Punch {PUNCH_TYPE_LABELS[p.punch_type]}
                          {p.captured_offline ? " (offline)" : ""}
                          {(p.flags ?? []).length ? ` [${(p.flags ?? []).join(", ")}]` : ""}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">Kiosk</td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{p.device_time ? formatDateTime(p.device_time) : ""}</td>
                      </tr>
                    ))}
                    {corrections.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{c.corrected_punched_at ? formatDateTime(c.corrected_punched_at) : ""}</td>
                        <td className="px-2 py-1">
                          {c.correction_type === "acknowledge" ? `Acknowledged ${c.exception_key ?? ""}` : `${CORRECTION_TYPE_LABELS[c.correction_type]}${c.punch_type ? ` ${PUNCH_TYPE_LABELS[c.punch_type]}` : ""}`}
                          {" · "}
                          {CORRECTION_REASON_LABELS[c.reason]}
                          {c.note ? ` · ${c.note}` : ""}
                        </td>
                        <td className="px-2 py-1 font-mono text-xs text-muted-foreground">{c.corrected_by.slice(0, 8)}</td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{formatDateTime(c.corrected_at)}</td>
                      </tr>
                    ))}
                    {rejections.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{r.device_time ? formatDateTime(r.device_time) : ""}</td>
                        <td className="px-2 py-1">Offline {r.punch_type} refused at sync ({r.reason})</td>
                        <td className="px-2 py-1 text-muted-foreground">Kiosk</td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{formatDateTime(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HorizontalScroll>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
