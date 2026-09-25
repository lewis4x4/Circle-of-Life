"use client";

/**
 * Tier 1 timeclock page (COL-352, spec 37 §6): one facility, one pay period,
 * one table. Staff name, status now, week minutes, overtime, exceptions.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  computeTimesheet,
  payPeriodContaining,
  shiftPayPeriod,
  statusNow,
  unresolvedExceptionCount,
  type PayPeriod,
  type PayPeriodSettings,
  type Timesheet,
} from "@/lib/timeclock/compute";
import {
  TIMECLOCK_COMPARE_LABEL,
  TIMECLOCK_EXPORT_LABEL,
  TIMECLOCK_MANAGER_ONLY,
  TIMECLOCK_NO_ROWS,
  TIMECLOCK_PAGE_SUBTITLE,
  TIMECLOCK_PAGE_TITLE,
  TIMECLOCK_PAY_PERIOD_UNSET,
  TIMECLOCK_PERIOD_UNSET_WEEK_NOTE,
  formatMinutesCompact,
  formatPeriodLabel,
  formatStatusNow,
  resolveExceptionsToExport,
} from "@/lib/timeclock/display-copy";
import { canChangeTimeclockSettings, canReviewTimeclock, loadOrganizationPayPeriod, loadTimeclockPeriod, type TimeclockPeriodData } from "@/lib/timeclock/load";
import { cn } from "@/lib/utils";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

import { PlannedScheduleContext } from "./PlannedScheduleContext";
import { MedTechShiftRulesPanel } from "./MedTechShiftRulesPanel";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 text-sm";

export type TimeclockOverviewProps = {
  now?: () => Date;
};

type Row = { staffId: string; name: string; status: string; weekMinutes: number; overtimeMinutes: number; exceptions: number; sheet: Timesheet };

export function TimeclockOverview({ now: nowProp }: TimeclockOverviewProps) {
  const now = useMemo(() => nowProp ?? (() => new Date()), [nowProp]);
  const { appRole, organizationId, user } = useHavenAuth();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const facilityName = availableFacilities.find((f) => f.id === facilityId)?.name ?? "";

  const [settings, setSettings] = useState<PayPeriodSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [data, setData] = useState<TimeclockPeriodData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<{ kind: "weekly" | "biweekly" | ""; anchor: string }>({ kind: "", anchor: "" });

  const canReview = canReviewTimeclock(appRole);
  const canSetPeriod = canChangeTimeclockSettings(appRole);

  useEffect(() => {
    if (!organizationId || !canReview) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadOrganizationPayPeriod(createClient(), organizationId);
        if (cancelled) return;
        setSettings(loaded);
        setPeriod(payPeriodContaining(now(), loaded));
        if (loaded?.timeclock_pay_period && loaded.timeclock_pay_period_anchor) {
          setPeriodDraft({ kind: loaded.timeclock_pay_period, anchor: loaded.timeclock_pay_period_anchor });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the pay period");
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, canReview, now]);

  const load = useCallback(async () => {
    if (!facilityId || !period || !canReview) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadTimeclockPeriod(createClient(), { facilityId, periodStart: period.start, periodEnd: period.end });
      setData(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the timeclock");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId, period, canReview]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: Row[] = useMemo(() => {
    if (!data || !period) return [];
    const at = now();
    return data.staff
      .map((s) => {
        const sheet = computeTimesheet({ staffId: s.id, punches: data.punches, corrections: data.corrections, rejections: data.rejections, floorUnlocks: data.floorUnlocks, periodStart: period.start, periodEnd: period.end, now: at });
        const hasActivity = sheet.effective.length > 0 || sheet.exceptions.length > 0;
        if (!hasActivity && s.employmentStatus !== "active") return null;
        return {
          staffId: s.id,
          name: s.name,
          status: formatStatusNow(statusNow(data.punches, data.corrections, s.id, at)),
          weekMinutes: sheet.periodWorkedMinutes,
          overtimeMinutes: sheet.periodOvertimeMinutes,
          exceptions: sheet.exceptions.filter((e) => !e.acknowledged).length,
          sheet,
        };
      })
      .filter((r): r is Row => r !== null);
  }, [data, period, now]);

  const unresolved = useMemo(() => unresolvedExceptionCount(rows.map((r) => r.sheet)), [rows]);
  const payPeriodSet = Boolean(settings?.timeclock_pay_period);
  const exportBlockedReason = !payPeriodSet ? TIMECLOCK_PAY_PERIOD_UNSET : unresolved > 0 ? resolveExceptionsToExport(unresolved) : null;

  const savePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organizationId || !user || !periodDraft.kind) return;
    const kind = periodDraft.kind;
    setSavingPeriod(true);
    setError(null);
    try {
      const supabase = createClient();
      const payload = { organization_id: organizationId, timeclock_pay_period: kind, timeclock_pay_period_anchor: periodDraft.anchor, updated_by: user.id };
      const { error: upsertError } = await supabase.from("timeclock_organization_settings").upsert(payload, { onConflict: "organization_id" });
      if (upsertError) throw new Error(upsertError.message);
      const next: PayPeriodSettings = { timeclock_pay_period: kind, timeclock_pay_period_anchor: periodDraft.anchor };
      setSettings(next);
      setPeriod(payPeriodContaining(now(), next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the pay period");
    } finally {
      setSavingPeriod(false);
    }
  };

  if (!canReview) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{TIMECLOCK_PAGE_TITLE}</h1>
        <p className="text-sm text-muted-foreground">{TIMECLOCK_MANAGER_ONLY}</p>
      </div>
    );
  }

  const periodQuery = period ? `?period_start=${period.startIso}` : "";

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{TIMECLOCK_PAGE_TITLE}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{TIMECLOCK_PAGE_SUBTITLE}</p>
          {facilityName ? <p className="mt-1 text-sm text-muted-foreground">{facilityName}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period ? (
            <div className="flex items-center gap-1" role="group" aria-label="Pay period">
              <Button type="button" variant="outline" size="sm" onClick={() => setPeriod(shiftPayPeriod(period, settings, -1))} aria-label="Previous period">
                ←
              </Button>
              <span className="px-2 text-sm tabular-nums" data-testid="period-label">
                {formatPeriodLabel(period.startIso, period.endIso)}
                {payPeriodSet ? null : <span className="text-muted-foreground"> ({TIMECLOCK_PERIOD_UNSET_WEEK_NOTE})</span>}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setPeriod(shiftPayPeriod(period, settings, 1))} aria-label="Next period">
                →
              </Button>
            </div>
          ) : null}
          {facilityId ? (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/timeclock/compare${periodQuery}`}>
              {TIMECLOCK_COMPARE_LABEL}
            </Link>
          ) : null}
          {facilityId && period ? (
            exportBlockedReason ? (
              <span className="inline-flex items-center gap-2">
                <Button type="button" size="sm" disabled aria-describedby="export-blocked">
                  {TIMECLOCK_EXPORT_LABEL}
                </Button>
                <span id="export-blocked" className="text-xs text-muted-foreground">
                  {exportBlockedReason}
                </span>
              </span>
            ) : (
              <a className={buttonVariants({ size: "sm" })} href={`/api/admin/timeclock/export?facility_id=${facilityId}&period_start=${period.startIso}`}>
                {TIMECLOCK_EXPORT_LABEL}
              </a>
            )
          ) : null}
        </div>
      </header>

      {facilityId && period && <PlannedScheduleContext facilityIds={[facilityId]} from={period.start.toISOString()} to={period.end.toISOString()} compact />}

      {canSetPeriod && settingsLoaded && !payPeriodSet ? (
        <form onSubmit={savePeriod} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4" aria-labelledby="pay-period-heading">
          <div className="w-full">
            <h2 id="pay-period-heading" className="text-sm font-semibold">
              Pay period
            </h2>
            <p className="text-xs text-muted-foreground">Frequency and the Monday the period starts on. Must match ADP.</p>
          </div>
          <div>
            <label htmlFor="pay-period-kind" className="text-xs font-medium text-muted-foreground">
              Frequency
            </label>
            <select
              id="pay-period-kind"
              className="mt-1 block h-9 rounded-[8px] border border-border bg-background px-2 text-sm"
              value={periodDraft.kind}
              onChange={(e) => setPeriodDraft((d) => ({ ...d, kind: e.target.value as "weekly" | "biweekly" | "" }))}
              required
            >
              {/* No pre-selection: the frequency must match ADP, so empty stays empty (COL-659). */}
              <option value="">Choose frequency</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
            </select>
          </div>
          <div>
            <label htmlFor="pay-period-anchor" className="text-xs font-medium text-muted-foreground">
              Anchor Monday
            </label>
            <input
              id="pay-period-anchor"
              type="date"
              className="mt-1 block h-9 rounded-[8px] border border-border bg-background px-2 text-sm"
              value={periodDraft.anchor}
              onChange={(e) => setPeriodDraft((d) => ({ ...d, anchor: e.target.value }))}
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={savingPeriod || !periodDraft.anchor || !periodDraft.kind}>
            Save pay period
          </Button>
        </form>
      ) : null}

      {error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}

      {facilityId && canReview ? <MedTechShiftRulesPanel facilityId={facilityId} facilityName={facilityName} now={now} /> : null}

      {!facilityId ? (
        <FacilityGateNotice reason="Punches, worked minutes and exceptions are kept per building, so the timeclock opens for one facility at a time." />
      ) : loading || !period ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <AdminEmptyState title={TIMECLOCK_NO_ROWS} description="Punches appear here as staff clock in on an enrolled tablet." />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <HorizontalScroll label="Timeclock overview">
            <table className="w-full">
              <caption className="sr-only">Timeclock summary for {facilityName || "this facility"}</caption>
              <thead className="bg-muted/40">
                <tr>
                  <th scope="col" className={TH}>Staff</th>
                  <th scope="col" className={TH}>Status now</th>
                  <th scope="col" className={cn(TH, "text-right")}>Period minutes</th>
                  <th scope="col" className={cn(TH, "text-right")}>Overtime</th>
                  <th scope="col" className={cn(TH, "text-right")}>Exceptions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.staffId} className="border-t border-border">
                    <td className={TD}>
                      <Link href={`/admin/timeclock/${row.staffId}${periodQuery}`} className="font-medium underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className={TD}>{row.status}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{formatMinutesCompact(row.weekMinutes)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{formatMinutesCompact(row.overtimeMinutes)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{row.exceptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScroll>
        </div>
      )}
    </div>
  );
}
