'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHavenAuth } from '@/contexts/haven-auth-context';
import { useFacilityStore } from '@/hooks/useFacilityStore';
import { useRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { dateLabel, reportDeadlineState, derivedValues, dollars, easternTime, metricDisplay, reportState, staffingPeriod, shiftDay, type StandUpReport } from '@/lib/stand-up/model';
import { StandUpEditor } from './editor';
import { HistoricalImports } from './imports';
import { StandUpRequestError, standUpRequest } from './transport';
import type { StandUpWorkspaceData } from './types';

export function StandUpWorkspace() {
  const auth = useHavenAuth();
  if (auth.loading) return <p role="status" className="p-6">Checking your Haven access…</p>;
  if (!auth.user || !auth.organizationId) return <p role="alert" className="p-6">Sign in to your Haven organization to open Stand Up.</p>;
  return <StandUpSession key={`${auth.organizationId}:${auth.user.id}:${auth.appRole}`} userId={auth.user.id} />;
}

function StandUpSession({ userId }: { userId: string }) {
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
        // A cached choice belongs to its actor. The authorized response always
        // validates it again before any form is mounted.
        if (data.facilities.length === 1) current.setSelectedFacility(data.facilities[0].id);
        else if (current.facilitiesCacheUserId !== userId || !data.facilities.some(f => f.id === current.selectedFacilityId)) current.setSelectedFacility(null);
        hydrated.current = true;
      }
    } catch (cause) {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'Reports could not be loaded. Try again.');
      // Failed authority revalidation removes the editable surface. An old list
      // of permitted facilities is never used to authorize a later operation.
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) setWorkspace(null);
    } finally { if (mounted.current && generation === loadGeneration.current) setLoading(false); }
  }, [userId]);
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
  const bindGuard = useCallback((next: (silent?: boolean) => boolean) => { guards.current.add(next); return () => { guards.current.delete(next); }; }, []);
  const accept = useCallback((saved: StandUpReport) => {
    if (!mounted.current) return;
    // An earlier refresh cannot overwrite a later confirmed save receipt.
    loadGeneration.current++;
    setWorkspace(current => current ? { ...current, reports: [...current.reports.filter(report => !(report.facility_id === saved.facility_id && report.week_start === saved.week_start)), saved] } : current);
  }, []);
  const deny = useCallback(() => { loadGeneration.current++; setWorkspace(null); setError('Your access changed. Refresh reports to check your current facility assignments.'); }, []);
  const changeWeek = (next: string) => { if (guard.current()) setWeek(next); };
  const currentReports = workspace?.reports.filter(report => report.week_start === week) ?? [];
  const weeks = workspace ? [...new Set([workspace.current_week, ...workspace.reports.map(report => report.week_start)])].sort().reverse() : [];
  const late = !!workspace && workspace.facilities.some(facility => reportDeadlineState(currentReports.find(report => report.facility_id === facility.id), week, workspace.current_week, now) === 'past_target');
  return <main className="mx-auto max-w-6xl space-y-6 p-4 pb-12 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-medium text-muted-foreground">MONDAY OPERATIONS</p><h1 className="mt-1 text-2xl font-semibold">Weekly Stand Up</h1><p className="mt-2 text-sm text-muted-foreground">Complete by 8:45 a.m. Eastern · Management call at 9:15 a.m.</p></div>
      {workspace && <Button variant="outline" disabled={loading || routePending} onClick={() => { if (guard.current()) void reload(false); }}>Refresh reports</Button>}
    </header>
    {error && workspace && <p role="alert" className="rounded border border-destructive p-3 text-sm">{error} Your current entries are retained.</p>}
    {loading ? <p role="status">Loading your permitted facilities and reports…</p> : error && !workspace ? <section role="alert" className="space-y-3 rounded border border-destructive p-4"><p>{error}</p><Button onClick={() => void reload(true)}>Check access and reload</Button></section> : workspace && <>
      {workspace.facilities.length === 0 ? <section className="rounded border border-border p-5"><h2 className="font-semibold">No facility assignment</h2><p className="mt-2 text-sm">Ask your company administrator to assign your Haven account to the ALF you report for. Entry stays unavailable until access is assigned.</p></section> : <>
        <section aria-label="Report identity" className="grid gap-4 border-y border-border py-4 sm:grid-cols-[1fr_auto]">
          <div><h2 className="text-xl font-semibold">{selected?.name ?? 'All facilities'}</h2><p className="mt-1 font-medium">Stand Up for {week && dateLabel(week, true)}</p><p className="mt-1 text-sm text-muted-foreground">Staffing and payroll: {week && staffingPeriod(week)}</p>{week === workspace.current_week && <p className="mt-1 text-xs text-muted-foreground">The next Monday report opens on Sunday, {dateLabel(shiftDay(workspace.current_week, 6))}.</p>}</div>
          <div className="space-y-3">
            {workspace.facilities.length > 1 && <label className="block text-xs font-medium">Reporting facility<select disabled={routePending} aria-label="Reporting facility" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={selected?.id ?? ''} onChange={e => { if (setSelectedFacility(e.target.value || null)) setTools(false); }}><option value="">All facilities — choose an ALF to enter</option>{workspace.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
            <label className="block text-xs font-medium">Meeting date<select disabled={routePending} aria-label="Meeting date" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={week} onChange={e => changeWeek(e.target.value)}>{weeks.map(value => <option key={value} value={value}>{dateLabel(value)}{value === workspace.current_week ? ' · open reporting period' : ' · history'}</option>)}</select></label>
          </div>
        </section>
        {!selected && <section aria-label="Reporting coverage" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Facility reports</h2><p className="text-sm">{currentReports.filter(report => report.status === 'ready').length} of {workspace.facilities.length} submitted{late ? ' · Haven submission target has passed' : week === workspace.current_week ? ' · Monday target: 8:45 a.m.' : ' · historical reports'}</p></div>
          <p className="text-sm text-muted-foreground">Choose the ALF you are reporting for. Populated figures still need administrator review before submission.</p>
          <div className="overflow-x-auto rounded border border-border" role="region" aria-label="Facility reporting overview" tabIndex={0}><table className="w-full text-left text-sm"><caption className="sr-only">Facility status and current reported operating figures</caption><thead className="bg-muted/40"><tr>{['Facility', 'Report status', 'Census', 'Open beds', 'Monthly rent roll', 'Overtime', ''].map((label, i) => <th key={i} scope="col" className="p-3 font-medium">{label || <span className="sr-only">Open report</span>}</th>)}</tr></thead><tbody>{workspace.facilities.map(facility => { const report = currentReports.find(item => item.facility_id === facility.id); const derived = report && derivedValues(report.values); return <tr key={facility.id} className="border-t border-border"><th scope="row" className="min-w-40 p-3 font-medium">{facility.name}</th><td className="min-w-44 p-3"><span>{reportState(report)}</span><span className="mt-1 block text-xs text-muted-foreground">{derived?.completed_fields ?? 0}/16 provided{reportDeadlineState(report, week, workspace.current_week, now) === 'past_target' ? ' · Haven submission target passed' : reportDeadlineState(report, week, workspace.current_week, now) === 'timing_unknown' ? ' · Submission timing not recorded' : ''}</span>{report && <span className="mt-1 block text-xs text-muted-foreground">Saved {easternTime(report.updated_at)}</span>}</td><td className="p-3 tabular-nums">{report?.values.current_total_census ?? '—'}</td><td className="p-3 tabular-nums">{derived?.total_beds_open ?? '—'}</td><td className="whitespace-nowrap p-3 tabular-nums">{dollars(report?.values.monthly_rent_roll_cents ?? null)}</td><td className="whitespace-nowrap p-3 tabular-nums">{metricDisplay('overtime_reported', report?.values.overtime_reported ?? null)}</td><td className="p-3"><Button variant="outline" onClick={() => setSelectedFacility(facility.id)} aria-label={`Open ${facility.name} report`}>Open report</Button></td></tr>; })}</tbody></table></div>
          <p className="text-xs text-muted-foreground">Blank figures are not zero. Reported figures have not yet been checked against payroll or other operating records.</p>
        </section>}
        {selected && hydrated.current && <StandUpEditor key={`${selected.id}:${week}`} facility={selected} week={week} currentWeek={workspace.current_week} report={currentReports.find(report => report.facility_id === selected.id)} reports={workspace.reports} recoveries={(workspace.pending_recoveries ?? []).filter(item => item.facility_id === selected.id && item.week_start === week)} canManage={canManage} userId={userId} now={now} onSaved={accept} onDenied={deny} bindGuard={bindGuard} onReload={() => reload(false)} />}
        {canManage && <section className="border-t border-border pt-4"><Button variant="ghost" disabled={routePending} aria-expanded={tools} onClick={() => { if (guard.current()) setTools(value => !value); }}>{tools ? 'Close management tools' : 'Management tools'}</Button>{tools && <HistoricalImports onReload={() => reload(false)} bindGuard={bindGuard} onDenied={deny} />}</section>}
      </>}
    </>}
  </main>;
}
