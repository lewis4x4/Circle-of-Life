'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useHavenAuth } from '@/contexts/haven-auth-context';
import { canOpenExecutiveStandup } from '@/lib/auth/executive-nav-access';
import { selectionBelongsToPeriod, useFacilityStore } from '@/hooks/useFacilityStore';
import { useRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { dateLabel, entryOpensStamp, entryWindowLine, mondayTimesFromSchedule, reportDeadlineState, derivedValues, easternTime, fieldDisplay, reportState, staffingPeriod, shiftDay, wallClockMinutes, FIELD_STATE_TEXT, type StandUpReport } from '@/lib/stand-up/model';
import { rosterSourceSuffix } from '@/lib/stand-up/roster-census';
import { MEETING_DAYS, MEETING_LABELS, type MeetingDay } from '@/lib/stand-up/meetings';
import { readReconcileRequest, reconcilesInPlace } from '@/lib/stand-up/census-disagreement';
import { CensusNotices } from './CensusNotices';
import { StandUpEditor } from './editor';
import { MeetingStandUp } from './meeting';
import { StandUpViewsNav } from './StandUpViewsNav';
import { EntryWindowSettings } from './entry-window-settings';
import { HistoricalImports } from './imports';
import { StandUpRequestError, standUpRequest } from './transport';
import type { StandUpWorkspaceData } from './types';

export function StandUpWorkspace() {
  const auth = useHavenAuth();
  // COL-555: a Reconcile link from anywhere census appears opens that facility's
  // report for that meeting with the Reconcile dialog.
  const [request] = useState(() => typeof window === 'undefined' ? null : readReconcileRequest(window.location.search));
  const [meeting, setMeeting] = useState<MeetingDay>(request?.meeting ?? 'monday');
  if (auth.loading) return <p role="status" className="p-6">Checking your Haven access…</p>;
  if (!auth.user || !auth.organizationId) return <p role="alert" className="p-6">Sign in to your Haven organization to open Stand Up.</p>;
  const session = `${auth.organizationId}:${auth.user.id}:${auth.appRole}`;
  // COL-752: recruiters attend Thursday and read it; Monday's weekly report is not theirs.
  if (auth.appRole === 'recruiter') return <MeetingStandUp key={session} day="thursday" />;
  const reconcile = request && request.meeting === meeting ? request.facilityId : null;
  // Switching meeting asks the open report first, so unsaved figures are never dropped.
  const picker = (guard: () => boolean) => <MeetingPicker value={meeting} onChange={next => { if (guard()) setMeeting(next); }} />;
  if (meeting !== 'monday') return <MeetingStandUp key={`${session}:${meeting}`} day={meeting} picker={picker} reconcileFacilityId={reconcile} />;
  return <StandUpSession key={session} userId={auth.user.id} canOpenRollUp={!!auth.appRole && canOpenExecutiveStandup(auth.appRole)} picker={picker} reconcileFacilityId={reconcile} reconcileNoticesHere={reconcilesInPlace(auth.appRole)} />;
}

function MeetingPicker({ value, onChange }: { value: MeetingDay; onChange: (next: MeetingDay) => void }) {
  return <label className="block text-xs font-medium">Meeting<select aria-label="Meeting" className="mt-1 block min-h-10 rounded border border-border bg-background px-3 text-sm" value={value} onChange={e => onChange(e.target.value as MeetingDay)}>
    {MEETING_DAYS.map(day => <option key={day} value={day}>{MEETING_LABELS[day]}</option>)}
  </select></label>;
}

function StandUpSession({ userId, canOpenRollUp, picker, reconcileFacilityId, reconcileNoticesHere = false }: { userId: string; canOpenRollUp: boolean; picker?: (guard: () => boolean) => ReactNode; reconcileFacilityId?: string | null; reconcileNoticesHere?: boolean }) {
  const routePending = useRouteTransitionPending();
  const selectedId = useFacilityStore(state => state.selectedFacilityId);
  const setSelectedFacility = useFacilityStore(state => state.setSelectedFacility);
  const [workspace, setWorkspace] = useState<StandUpWorkspaceData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState('');
  const [tools, setTools] = useState(false);
  const [now, setNow] = useState(new Date());
  const clockOffset = useRef(0);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const guards = useRef(new Set<(silent?: boolean) => boolean>());
  const guard = useRef((silent = false) => [...guards.current].every(check => check(silent)));
  const hydrated = useRef(false);
  const selected = workspace?.facilities.find(facility => facility.id === selectedId);
  const canManage = workspace?.can_import === true;
  const reload = useCallback(async (initial = false) => {
    const generation = ++loadGeneration.current;
    if (initial) setLoading(true);
    try {
      const data = await standUpRequest<StandUpWorkspaceData>('workspace');
      if (!mounted.current || generation !== loadGeneration.current) return;
      setWorkspace(data); setError('');
      if (data.server_now) clockOffset.current = Date.parse(data.server_now) - Date.now();
      setNow(new Date(Date.now() + clockOffset.current));
      if (initial) {
        setWeek(data.current_week);
        const current = useFacilityStore.getState();
        // A cached choice belongs to its actor and to one reporting period. The
        // authorized response always validates it again before any form is mounted,
        // and an account with more than one grant chooses again each new Monday.
        if (data.facilities.length === 1) current.setSelectedFacility(data.facilities[0].id);
        else if (reconcileFacilityId && data.facilities.some(f => f.id === reconcileFacilityId)) current.setSelectedFacility(reconcileFacilityId);
        else if (current.facilitiesCacheUserId !== userId || !data.facilities.some(f => f.id === current.selectedFacilityId) || !selectionBelongsToPeriod(current.selectedReportingPeriod, data.current_week)) current.setSelectedFacility(null);
        hydrated.current = true;
      }
    } catch (cause) {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'Reports could not be loaded. Try again.');
      // Failed authority revalidation removes the editable surface. An old list
      // of permitted facilities is never used to authorize a later operation.
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) setWorkspace(null);
    } finally { if (mounted.current && generation === loadGeneration.current) setLoading(false); }
  }, [userId, reconcileFacilityId]);
  useEffect(() => {
    mounted.current = true; void reload(true);
    const clock = window.setInterval(() => setNow(new Date(Date.now() + clockOffset.current)), 15000);
    const focus = () => { if (guard.current(true)) void reload(false); };
    const refresh = window.setInterval(focus, 60000);
    window.addEventListener('focus', focus);
    const invalidate = () => { loadGeneration.current++; };
    return () => { mounted.current = false; invalidate(); clearInterval(clock); clearInterval(refresh); window.removeEventListener('focus', focus); };
  }, [reload]);
  useLayoutEffect(() => useFacilityStore.getState().registerFacilityChangeGuard(() => guard.current()), []);
  const currentWeek = workspace?.current_week;
  useEffect(() => { if (hydrated.current && selectedId && currentWeek) useFacilityStore.getState().stampSelectionPeriod(currentWeek); }, [selectedId, currentWeek]);
  const bindGuard = useCallback((next: (silent?: boolean) => boolean) => { guards.current.add(next); return () => { guards.current.delete(next); }; }, []);
  const accept = useCallback((saved: StandUpReport) => {
    if (!mounted.current) return;
    // An earlier refresh cannot overwrite a later confirmed save receipt.
    loadGeneration.current++;
    // COL-298: a not-started receipt means no report exists for that facility
    // and Monday, so the overview drops the row rather than showing an empty Draft.
    setWorkspace(current => current ? { ...current, reports: [...current.reports.filter(report => !(report.facility_id === saved.facility_id && report.week_start === saved.week_start)), ...(saved.not_started ? [] : [saved])] } : current);
  }, []);
  const deny = useCallback(() => { loadGeneration.current++; setWorkspace(null); setError('Your access changed. Refresh reports to check your current facility assignments.'); }, []);
  const changeWeek = (next: string) => { if (guard.current()) setWeek(next); };
  // The meeting a chosen facility may enter now. Without a facility this is the
  // organization week, which is what the all-facilities overview has always shown.
  const openWeek = selected?.open_week ?? workspace?.current_week ?? '';
  // Following a facility's own window is safe: the store already refuses a
  // facility change while entries are unsaved.
  useEffect(() => { if (hydrated.current && openWeek) setWeek(openWeek); }, [selectedId, openWeek]);
  const currentReports = workspace?.reports.filter(report => report.week_start === week) ?? [];
  // COL-805: Monday's deadline and call from the schedule.
  const times = mondayTimesFromSchedule(workspace?.schedule);
  const weeks = workspace ? [...new Set([
    // A chosen facility can look at the meeting ahead and read when it opens.
    ...(selected && openWeek ? [shiftDay(openWeek, 7)] : []),
    workspace.current_week, openWeek, ...workspace.reports.map(report => report.week_start),
  ].filter(Boolean))].sort().reverse() : [];
  const late = !!workspace && workspace.facilities.some(facility => reportDeadlineState(currentReports.find(report => report.facility_id === facility.id), week, workspace.current_week, now, times) === 'past_target');
  const google = workspace?.google_connection;
  const googleLastChecked = google?.last_checked_at ? Date.parse(google.last_checked_at) : Number.NaN;
  const googleDelayed = google?.state === 'connected' && (!Number.isFinite(googleLastChecked) || now.getTime() - googleLastChecked > 5 * 60_000);
  return <div className="mx-auto max-w-6xl space-y-6 p-4 pb-12 md:p-6">
    {canOpenRollUp && <StandUpViewsNav current="/admin/stand-up" />}
    <header className="flex flex-wrap items-start justify-between gap-4">
      {/* Tier 1: when this report opens, when it is due, when the call is. The
          open is the chosen facility's own, so a widened ALF reads its own. */}
      <div><h1 className="text-2xl font-semibold">Weekly Stand Up</h1><p className="mt-1 text-base font-medium">{entryWindowLine(selected?.entry_open_lead_minutes, times)}</p></div>
      <div className="flex flex-wrap items-end gap-3">
        {picker?.(() => guard.current())}
        {workspace && <Button variant="outline" disabled={loading || routePending} onClick={() => { if (guard.current()) void reload(false); }}>Refresh reports</Button>}
      </div>
    </header>
    {google?.state === 'reconnect_required' && <section role="alert" className="space-y-2 rounded border border-destructive bg-destructive/5 p-4"><h2 className="font-semibold">Google workbook disconnected</h2><p className="text-sm">Drive changes are not reaching Haven. Reconnect the dedicated Stand Up account before relying on workbook figures.</p>{google.last_success_at && <p className="text-xs text-muted-foreground">Last successful workbook synchronization: {easternTime(google.last_success_at)}.</p>}</section>}
    {googleDelayed && <section role="alert" className="space-y-2 rounded border border-warning bg-warning/5 p-4"><h2 className="font-semibold">Google workbook synchronization is delayed</h2><p className="text-sm">The connector has not completed within five minutes. Drive may be newer than Haven; check the connection before using these figures.</p>{google?.last_checked_at && <p className="text-xs text-muted-foreground">Last connector check: {easternTime(google.last_checked_at)}.</p>}</section>}
    {error && workspace && <p role="alert" className="rounded border border-destructive p-3 text-sm">{error} Your current entries are retained.</p>}
    <CensusNotices refreshKey={currentReports.map(report => report.version).join(':')} reconcileHere={reconcileNoticesHere} />
    {loading ? <p role="status">Loading your permitted facilities and reports…</p> : error && !workspace ? <section role="alert" className="space-y-3 rounded border border-destructive p-4"><p>{error}</p><Button onClick={() => void reload(true)}>Check access and reload</Button></section> : workspace && <>
      {workspace.facilities.length === 0 ? <section className="rounded border border-border p-5"><h2 className="font-semibold">No facility assignment</h2><p className="mt-2 text-sm">Ask your company administrator to assign your Haven account to the ALF you report for. Entry stays unavailable until access is assigned.</p></section> : <>
        <section aria-label="Report identity" className="grid gap-4 border-y border-border py-4 sm:grid-cols-[1fr_auto]">
          {/* Identity only: which ALF, which meeting. The reporting periods each
              section covers are stated on that section, and the remaining
              timings sit in the report's own disclosure rather than here. */}
          <div><h2 className="text-xl font-semibold">{selected?.name ?? 'All facilities'}</h2><p className="mt-1 font-medium">Stand Up for {week && dateLabel(week, true)}</p>{!selected && week === workspace.current_week && <p className="mt-1 text-sm text-muted-foreground">Staffing and payroll covers {staffingPeriod(week)}. The next Monday report opens {entryOpensStamp(shiftDay(workspace.current_week, 7), undefined, times)}.</p>}</div>
          <div className="space-y-3">
            {workspace.facilities.length > 1 && <label className="block text-xs font-medium">Reporting facility<select disabled={routePending} aria-label="Reporting facility" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={selected?.id ?? ''} onChange={e => { if (setSelectedFacility(e.target.value || null)) setTools(false); }}><option value="">All facilities — choose an ALF to enter</option>{workspace.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
            <label className="block text-xs font-medium">Meeting date<select disabled={routePending} aria-label="Meeting date" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={week} onChange={e => changeWeek(e.target.value)}>{weeks.map(value => <option key={value} value={value}>{dateLabel(value)}{value === openWeek ? ' · open reporting period' : value > openWeek ? ` · opens ${entryOpensStamp(value, selected?.entry_open_lead_minutes, times)}` : ' · history'}</option>)}</select></label>
          </div>
        </section>
        {!selected && <section aria-label="Reporting coverage" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Facility reports</h2><p className="text-sm">{currentReports.filter(report => report.status === 'ready').length} of {workspace.facilities.length} submitted{late ? ' · Haven submission target has passed' : week === workspace.current_week ? ` · Monday target: ${wallClockMinutes(times.dueMinutes)}` : ' · historical reports'}</p></div>
          <p className="text-sm text-muted-foreground">Choose the ALF you are reporting for. Populated figures still need administrator review before submission.</p>
          <div className="overflow-x-auto rounded border border-border" role="region" aria-label="Facility reporting overview" tabIndex={0}><table className="w-full text-left text-sm"><caption className="sr-only">Facility status and current reported operating figures</caption><thead className="bg-muted/40"><tr>{['Facility', 'Report status', 'Census', 'Open beds', 'Monthly rent roll', 'Overtime', ''].map((label, i) => <th key={i} scope="col" className="p-3 font-medium">{label || <span className="sr-only">Open report</span>}</th>)}</tr></thead><tbody>{workspace.facilities.map(facility => { const report = currentReports.find(item => item.facility_id === facility.id); const derived = report && derivedValues(report.values); return <tr key={facility.id} className="border-t border-border"><th scope="row" className="min-w-40 p-3 font-medium">{facility.name}</th><td className="min-w-44 p-3"><span>{reportState(report)}</span><span className="mt-1 block text-xs text-muted-foreground">{derived?.completed_fields ?? 0}/16 provided{reportDeadlineState(report, week, workspace.current_week, now, times) === 'past_target' ? ' · Haven submission target passed' : reportDeadlineState(report, week, workspace.current_week, now, times) === 'timing_unknown' ? ' · Original submission time unavailable' : ''}</span>{report && <span className="mt-1 block text-xs text-muted-foreground">Saved {easternTime(report.updated_at)}</span>}</td><td className="p-3 tabular-nums">{fieldDisplay(report, 'current_total_census')}{rosterSourceSuffix(report?.roster_confirmations?.current_total_census) && <span className="text-xs text-muted-foreground"> · {rosterSourceSuffix(report?.roster_confirmations?.current_total_census)}</span>}</td><td className="p-3 tabular-nums">{derived?.total_beds_open ?? (reportState(report) === 'Not started' ? FIELD_STATE_TEXT.no_report : FIELD_STATE_TEXT.not_provided)}</td><td className="whitespace-nowrap p-3 tabular-nums">{fieldDisplay(report, 'monthly_rent_roll_cents')}</td><td className="whitespace-nowrap p-3 tabular-nums">{fieldDisplay(report, 'overtime_reported')}</td><td className="p-3"><Button variant="outline" onClick={() => setSelectedFacility(facility.id)} aria-label={`Open ${facility.name} report`}>Open report</Button></td></tr>; })}</tbody></table></div>
          <p className="text-xs text-muted-foreground">Blank figures are not zero. Reported figures have not yet been checked against payroll or other operating records.</p>
        </section>}
        {selected && hydrated.current && <StandUpEditor key={`${selected.id}:${week}`} facility={selected} week={week} currentWeek={openWeek} leadMinutes={selected.entry_open_lead_minutes} report={currentReports.find(report => report.facility_id === selected.id)} reports={workspace.reports} autoReconcile={selected.id === reconcileFacilityId} recoveries={(workspace.pending_recoveries ?? []).filter(item => item.facility_id === selected.id && item.week_start === week)} canManage={canManage} canEditSubmitted={workspace.can_edit_submitted === true} userId={userId} times={times} now={now} onSaved={accept} onDenied={deny} bindGuard={bindGuard} onReload={() => reload(false)} />}
        {canManage && <section className="border-t border-border pt-4"><Button variant="ghost" disabled={routePending} aria-expanded={tools} onClick={() => { if (guard.current()) setTools(value => !value); }}>{tools ? 'Close management tools' : 'Management tools'}</Button>{tools && <><EntryWindowSettings times={times} facilities={workspace.facilities} disabled={routePending || loading} onSaved={() => reload(false)} onDenied={deny} /><HistoricalImports onReload={() => reload(false)} bindGuard={bindGuard} onDenied={deny} /></>}</section>}
      </>}
    </>}
  </div>;
}
