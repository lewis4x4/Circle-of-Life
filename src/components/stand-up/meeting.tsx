'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { registerRouteLeaveGuard, useRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFacilityStore } from '@/hooks/useFacilityStore';
import { dateLabel, easternStamp } from '@/lib/stand-up/model';
import {
  MEETING_LABELS, THURSDAY_FIGURES, THURSDAY_KEYS, emptyThursdayValues, meetingReportState, meetingStamp, meetingWindowLine,
  mondayComparison, parseThursdayField, thursdayDisplay, thursdayFieldText,
  type MeetingDay, type MeetingFacility, type MeetingHistory, type MeetingReport, type MeetingWorkspace, type MondaySubmitted, type ThursdayKey, type ThursdayValues,
} from '@/lib/stand-up/meetings';
import { StandUpRequestError, standUpRequest } from './transport';
import { CensusDisagreementChips, loadCensusDisagreements } from './CensusDisagreementChip';
import { CensusNotices } from './CensusNotices';
import { ReconcileDialog } from './ReconcileDialog';
import { showsChip, type CensusDisagreement } from '@/lib/stand-up/census-disagreement';
import Link from 'next/link';
import { reportFigureLine, thursdayPrefill, thursdayPrintHref, type FacilityReport, type ThursdayReport } from '@/lib/stand-up/thursday-report';
import { ThursdayReportSections } from './ThursdayReportSections';
import { useCensusReasonOptions } from './useCensusReasonOptions';
import { isOverrideReason, isRosterFieldKey, recordedConfirmationLine, rosterSuggestion, type OverrideReason, type RosterCensus, type RosterFieldKey } from '@/lib/stand-up/roster-census';

type Fields = Record<ThursdayKey, string>;
const fieldsFor = (values: ThursdayValues = emptyThursdayValues()): Fields =>
  Object.fromEntries(THURSDAY_KEYS.map(key => [key, thursdayFieldText(key, values[key])])) as Fields;

/**
 * A Stand Up meeting other than Monday (COL-752). Thursday: the administrator
 * gives four figures beside what they submitted on Monday; recruiters read the
 * same page and write nothing. The window, due time and call time are the
 * server's schedule, never this file's.
 */
export function MeetingStandUp({ day, picker, reconcileFacilityId }: { day: MeetingDay; picker?: (guard: () => boolean) => ReactNode; reconcileFacilityId?: string | null }) {
  const routePending = useRouteTransitionPending();
  const [workspace, setWorkspace] = useState<MeetingWorkspace | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [week, setWeek] = useState('');
  const dirty = useRef(false);
  const guard = useCallback(() => {
    if (!dirty.current) return true;
    setError('Save or discard this report’s unsaved figures before switching facility, week or meeting.');
    return false;
  }, []);
  useLayoutEffect(() => registerRouteLeaveGuard(silent => silent ? !dirty.current : guard()), [guard]);
  const reload = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const data = await standUpRequest<MeetingWorkspace>('workspace', { meeting_day: day });
      setWorkspace(data); setError('');
      if (initial) {
        const stored = useFacilityStore.getState().selectedFacilityId;
        const chosen = data.facilities.length === 1 ? data.facilities[0].id
          : reconcileFacilityId && data.facilities.some(facility => facility.id === reconcileFacilityId) ? reconcileFacilityId
          : data.facilities.some(facility => facility.id === stored) ? stored : null;
        setFacilityId(chosen);
        setWeek(data.facilities.find(facility => facility.id === chosen)?.open_week ?? data.current_week ?? '');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reports could not be loaded. Try again.');
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) setWorkspace(null);
    } finally { setLoading(false); }
  }, [day, reconcileFacilityId]);
  useEffect(() => { void reload(true); }, [reload]);

  const label = MEETING_LABELS[day];
  const line = workspace ? meetingWindowLine(workspace.schedule, day) : null;
  const selected = workspace?.facilities.find(facility => facility.id === facilityId);
  const openWeek = selected?.open_week ?? workspace?.current_week ?? '';
  const weeks = workspace ? [...new Set([openWeek, ...workspace.reports.filter(report => !facilityId || report.facility_id === facilityId).map(report => report.week_start)].filter(Boolean))].sort().reverse() : [];
  const reportsForWeek = workspace?.reports.filter(report => report.week_start === week) ?? [];
  const baseline = (facility: string): MondaySubmitted | undefined =>
    reportsForWeek.find(report => report.facility_id === facility)?.monday_submitted
      ?? workspace?.monday_baselines.find(item => item.facility_id === facility && item.week_start === week)?.monday_submitted;
  const chooseFacility = (next: string | null) => {
    if (!guard()) return;
    setFacilityId(next);
    if (next) useFacilityStore.getState().setSelectedFacility(next);
    setWeek(workspace?.facilities.find(facility => facility.id === next)?.open_week ?? workspace?.current_week ?? '');
  };
  // COL-754: the facility's Thursday report: Haven's figures, who left and who is
  // away, the potential residents and the recruiters' activity since Monday.
  const [facilityReport, setFacilityReport] = useState<{ key: string; report: FacilityReport | null; error: string } | null>(null);
  const reportKey = selected && week ? `${selected.id}:${week}` : null;
  useEffect(() => {
    if (!reportKey || !selected) return;
    let live = true;
    standUpRequest<ThursdayReport>('report', { meeting_day: day, facility_id: selected.id, week_start: week })
      .then(data => { if (live) setFacilityReport({ key: reportKey, report: data.facilities.find(item => item.facility_id === selected.id) ?? null, error: '' }); })
      .catch(cause => { if (live) setFacilityReport({ key: reportKey, report: null, error: cause instanceof Error ? cause.message : 'The report could not be read.' }); });
    return () => { live = false; };
  }, [reportKey, selected, day, week]);
  const currentReport = facilityReport?.key === reportKey ? facilityReport : null;
  const accept = useCallback((saved: MeetingReport) => {
    setWorkspace(current => current ? { ...current, reports: [...current.reports.filter(report => !(report.facility_id === saved.facility_id && report.week_start === saved.week_start)), ...(saved.not_started ? [] : [saved])] } : current);
  }, []);

  return <div className="mx-auto max-w-6xl space-y-6 p-4 pb-12 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{label} Stand Up</h1>
        {line && <p className="mt-1 text-base font-medium">{line}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {picker?.(guard)}
        {workspace?.scheduled && day === 'thursday' && <Link href={thursdayPrintHref({ facilityId, week })} target="_blank" className="inline-flex min-h-10 items-center rounded border border-border px-3 text-sm font-medium">Print the report</Link>}
        {workspace && <Button variant="outline" disabled={loading || routePending} onClick={() => { if (guard()) void reload(false); }}>Refresh reports</Button>}
      </div>
    </header>
    {error && workspace && <p role="alert" className="rounded border border-destructive p-3 text-sm">{error}</p>}
    {workspace?.can_edit && <CensusNotices refreshKey={workspace.reports.map(report => report.version).join(':')} />}
    {loading ? <p role="status">Loading your permitted facilities and reports…</p>
      : !workspace ? <section role="alert" className="space-y-3 rounded border border-destructive p-4"><p>{error || 'Reports could not be loaded.'}</p><Button onClick={() => void reload(true)}>Check access and reload</Button></section>
      : !workspace.scheduled ? <section className="rounded border border-border p-5"><h2 className="font-semibold">No {label} meeting is scheduled</h2><p className="mt-2 text-sm">Your company administrator sets which days Stand Up meets.</p></section>
      : workspace.facilities.length === 0 ? <section className="rounded border border-border p-5"><h2 className="font-semibold">No facility assignment</h2><p className="mt-2 text-sm">Ask your company administrator to assign your Haven account to the buildings you work with.</p></section>
      : <>
        <section aria-label="Report identity" className="grid gap-4 border-y border-border py-4 sm:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-xl font-semibold">{selected?.name ?? 'All facilities'}</h2>
            <p className="mt-1 font-medium">{label} Stand Up for the week of {week && dateLabel(week)}</p>
            {!workspace.can_edit && <p className="mt-1 text-sm text-muted-foreground">You can read these figures. The facility administrator enters them.</p>}
          </div>
          <div className="space-y-3">
            {workspace.facilities.length > 1 && <label className="block text-xs font-medium">Facility<select disabled={routePending} aria-label="Facility" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={facilityId ?? ''} onChange={e => chooseFacility(e.target.value || null)}><option value="">All facilities</option>{workspace.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>}
            <label className="block text-xs font-medium">Meeting week<select disabled={routePending} aria-label="Meeting week" className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm" value={week} onChange={e => { if (guard()) setWeek(e.target.value); }}>{weeks.map(value => <option key={value} value={value}>Week of {dateLabel(value)}{value === openWeek ? ' · open reporting period' : ' · history'}</option>)}</select></label>
          </div>
        </section>
        {!selected ? <MeetingOverview facilities={workspace.facilities} reports={reportsForWeek} baseline={baseline} onOpen={chooseFacility} />
          : <MeetingEditor key={`${selected.id}:${week}`} day={day} facility={selected} week={week} openWeek={openWeek}
              report={reportsForWeek.find(report => report.facility_id === selected.id)} monday={baseline(selected.id) ?? null}
              canEdit={workspace.can_edit} dirty={dirty} onSaved={accept} onError={setError} autoReconcile={selected.id === reconcileFacilityId}
              haven={currentReport?.report ?? undefined} />}
        {selected && day === 'thursday' && (currentReport?.report ? <ThursdayReportSections report={currentReport.report} />
          : currentReport?.error ? <p role="alert" className="rounded border border-destructive p-3 text-sm">{currentReport.error}</p>
          : <p role="status" className="text-sm">Loading the potential residents and recruiter activity…</p>)}
      </>}
  </div>;
}

function MeetingOverview({ facilities, reports, baseline, onOpen }: { facilities: MeetingFacility[]; reports: MeetingReport[]; baseline: (facility: string) => MondaySubmitted | undefined; onOpen: (id: string) => void }) {
  return <section aria-label="Facility reports" className="space-y-3">
    <h2 className="text-lg font-semibold">Facility reports</h2>
    <div className="overflow-x-auto rounded border border-border" role="region" aria-label="Facility reporting overview" tabIndex={0}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Each facility’s figures for this meeting</caption>
        <thead className="bg-muted/40"><tr><th scope="col" className="p-3 font-medium">Facility</th><th scope="col" className="p-3 font-medium">Report status</th>{THURSDAY_FIGURES.map(figure => <th key={figure.key} scope="col" className="p-3 font-medium">{figure.label}</th>)}<th scope="col" className="p-3"><span className="sr-only">Open report</span></th></tr></thead>
        <tbody>{facilities.map(facility => {
          const report = reports.find(item => item.facility_id === facility.id)
          const started = meetingReportState(report) !== 'Not started'
          return <tr key={facility.id} className="border-t border-border">
            <th scope="row" className="min-w-40 p-3 font-medium">{facility.name}</th>
            <td className="p-3">{meetingReportState(report)}{!baseline(facility.id) && <span className="mt-1 block text-xs text-muted-foreground">Monday not submitted</span>}</td>
            {THURSDAY_FIGURES.map(figure => <td key={figure.key} className="whitespace-nowrap p-3 tabular-nums">{started ? thursdayDisplay(figure.key, report!.values[figure.key]) : 'No report'}</td>)}
            <td className="p-3"><Button variant="outline" onClick={() => onOpen(facility.id)} aria-label={`Open ${facility.name} report`}>Open report</Button></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <p className="text-xs text-muted-foreground">Blank figures are not zero.</p>
  </section>;
}

type EditorProps = {
  day: MeetingDay; facility: MeetingFacility; week: string; openWeek: string; report?: MeetingReport; monday: MondaySubmitted
  canEdit: boolean; dirty: { current: boolean }; onSaved: (report: MeetingReport) => void; onError: (message: string) => void
  /** COL-555: opened from a Reconcile link. */
  autoReconcile?: boolean
  /** COL-754: Haven's own Thursday figures for this facility, to prefill and show beside each input. */
  haven?: FacilityReport
};

function MeetingEditor({ day, facility, week, openWeek, report, monday, canEdit, dirty, onSaved, onError, autoReconcile, haven }: EditorProps) {
  const [saved, setSaved] = useState(report);
  const [fields, setFields] = useState(() => fieldsFor(report?.values));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [changed, setChanged] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => { dirty.current = changed; return () => { dirty.current = false; }; }, [changed, dirty]);
  const notOpen = week > openWeek;
  const historical = week < openWeek;
  const editable = canEdit && !notOpen;
  const meetingWindow = facility.window && facility.window.week_start === week ? facility.window : null;
  let typed: ThursdayValues | null = null; let parseError = '';
  try { typed = Object.fromEntries(THURSDAY_KEYS.map(key => [key, parseThursdayField(key, fields[key])])) as ThursdayValues; } catch (cause) { parseError = cause instanceof Error ? cause.message : 'Check the figures.'; }
  const complete = !!typed && THURSDAY_KEYS.every(key => typed![key] !== null);
  // COL-754: a report nobody has started opens with Haven's figures for the
  // administrator to verify; blanks stay blank, and nothing saves until they do.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!haven || prefilled.current || saved || changed || week !== openWeek || !canEdit) return;
    prefilled.current = true;
    setFields(fieldsFor(thursdayPrefill(haven, emptyThursdayValues())));
  }, [haven, saved, changed, week, openWeek, canEdit]);
  // COL-555: this meeting's census against the roster, with the Reconcile dialog.
  const [reconcileTarget, setReconcileTarget] = useState<CensusDisagreement | null>(null);
  const [disagreementTick, setDisagreementTick] = useState(0);
  const current = week === openWeek;
  // COL-555: Thursday records a reason for a census or hospital figure that
  // differs from the roster, from the facility's reason list (a setting). A
  // draft may keep the difference open; submitting needs the reason.
  const [roster, setRoster] = useState<RosterCensus | null>(null);
  const [rosterReasons, setRosterReasons] = useState<Partial<Record<RosterFieldKey, OverrideReason>>>({});
  const [rosterTick, setRosterTick] = useState(0);
  const reasonOptions = useCensusReasonOptions(facility.id, current && editable);
  useEffect(() => {
    if (!current || !editable) return;
    let live = true;
    standUpRequest<RosterCensus>('roster', { facility_id: facility.id })
      .then(data => { if (live && data.facility_id === facility.id) setRoster(data); })
      .catch(() => { if (live) setRoster(null); });
    return () => { live = false; };
  }, [current, editable, facility.id, rosterTick]);
  const differsFromRoster = (key: RosterFieldKey): number | null => {
    const suggested = rosterSuggestion(roster, key);
    const value = typed ? typed[key] : null;
    return suggested !== null && value !== null && value !== suggested ? suggested : null;
  };
  useEffect(() => {
    if (!autoReconcile || !current) return;
    let live = true;
    void loadCensusDisagreements(facility.id).then(rows => {
      const row = rows?.find(item => item.meeting_day === day && item.facility_id === facility.id && showsChip(item));
      if (live && row) setReconcileTarget(row);
    });
    return () => { live = false; };
  }, [autoReconcile, current, facility.id, day]);

  const save = async (status: 'draft' | 'ready', reasonsOverride?: Partial<Record<RosterFieldKey, OverrideReason>>) => {
    if (!typed) { setProblem(parseError); return; }
    if (historical && !reason.trim()) { setProblem('A past meeting needs a written reason for the change.'); return; }
    const chosen = reasonsOverride ?? rosterReasons;
    const unexplained = current ? (['current_total_census', 'hospital_and_rehab_total'] as RosterFieldKey[]).filter(key => differsFromRoster(key) !== null && !chosen[key]) : [];
    if (status === 'ready' && unexplained.length) {
      setProblem(unexplained.map(key => `${key === 'current_total_census' ? 'Current census' : 'Residents at hospital or rehab'} differs from the roster (${differsFromRoster(key)}). Choose why it is different, or use the roster figure.`).join(' '));
      return;
    }
    const rosterBlock = current ? Object.fromEntries((['current_total_census', 'hospital_and_rehab_total'] as RosterFieldKey[])
      .filter(key => differsFromRoster(key) !== null && chosen[key]).map(key => [key, { override_reason: chosen[key] }])) : {};
    const payload: Record<string, unknown> = { meeting_day: day, facility_id: facility.id, week_start: week, expected_version: saved?.version ?? 0, status, values: typed, ...(historical ? { reason: reason.trim() } : {}), ...(Object.keys(rosterBlock).length ? { roster: rosterBlock } : {}) };
    // The same attempt keeps its request id so a retried save returns its receipt instead of saving twice.
    const key = JSON.stringify(payload);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(true); setProblem(''); setMessage('');
    try {
      const result = await standUpRequest<MeetingReport>('save', { ...payload, request_id: request.current.id });
      request.current = null;
      setSaved(result.not_started ? undefined : result); setFields(fieldsFor(result.values)); setChanged(false);
      setDisagreementTick(tick => tick + 1); setRosterTick(tick => tick + 1);
      onSaved(result);
      setMessage(status === 'ready' ? `Submitted ${meetingStamp(result.last_submitted_at)}.` : 'Draft saved.');
    } catch (cause) {
      if (cause instanceof StandUpRequestError && cause.status === 409 && !cause.code) { request.current = null; setProblem('Someone else saved this report since you opened it. Refresh reports to see their figures before changing them.'); }
      else if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) onError('Your access changed. Refresh reports to check your facility assignments.');
      else setProblem(cause instanceof Error ? cause.message : 'The report could not be saved. Your figures are still here.');
    } finally { setBusy(false); }
  };

  return <section aria-label={`${facility.name} ${MEETING_LABELS[day]} report`} className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">{meetingReportState(saved)}</h2>
      {meetingWindow && <p className="text-sm text-muted-foreground">Due {easternStamp(meetingWindow.entry_due_at)} · Call {easternStamp(meetingWindow.call_at)}</p>}
    </div>
    {notOpen && <p role="status" className="rounded border border-border p-3 text-sm">This report opens {meetingWindow?.entry_opens_at ? easternStamp(meetingWindow.entry_opens_at) : 'after the meeting before it'}.</p>}
    {saved?.updated_at && <p className="text-xs text-muted-foreground">Last saved {meetingStamp(saved.updated_at)}{saved.updated_by_name ? ` by ${saved.updated_by_name}` : ''}{saved.last_submitted_at ? ` · Submitted ${meetingStamp(saved.last_submitted_at)}` : ''}</p>}
    {current && <CensusDisagreementChips facilityId={facility.id} meetingDay={day} refreshKey={`${saved?.version ?? 'new'}:${disagreementTick}`}
      action={d => <Button variant="outline" size="sm" onClick={() => setReconcileTarget(d)}>Reconcile</Button>} />}
    {reconcileTarget && <ReconcileDialog disagreement={reconcileTarget} open onOpenChange={next => { if (!next) setReconcileTarget(null); }} canChange={editable}
      onUseRoster={figure => { if (figure.roster === null) return; setFields(prev => ({ ...prev, [figure.key]: String(figure.roster) })); setChanged(true); setMessage(''); }}
      canFixRoster={canEdit}
      onExplain={editable && current ? (figure, why) => { const next = { ...rosterReasons, [figure.key]: why }; setRosterReasons(next); void save('draft', next); } : undefined}
      explainUnavailable={`A reason can be recorded only on the open ${MEETING_LABELS[day]} report, by its administrator. Put the roster’s figure on it, or fix the roster.`}
      onCheckAgain={() => { setDisagreementTick(tick => tick + 1); setRosterTick(tick => tick + 1); }} />}
    <p className="text-sm text-muted-foreground">{monday ? `Compared with what was submitted on Monday, ${meetingStamp(monday.submitted_at)}.` : 'Monday’s report for this week was not submitted, so there is nothing to compare with.'}</p>
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{MEETING_LABELS[day]} figures beside Monday’s submitted figures</caption>
        <thead className="bg-muted/40"><tr><th scope="col" className="p-3 font-medium">Figure</th><th scope="col" className="p-3 font-medium">{MEETING_LABELS[day]}</th><th scope="col" className="p-3 font-medium">Monday submitted</th><th scope="col" className="p-3 font-medium">Change</th></tr></thead>
        <tbody>{THURSDAY_FIGURES.map(figure => {
          const current = typed ? typed[figure.key] : saved?.values[figure.key] ?? null
          const comparison = mondayComparison(figure.key, current, monday)
          return <tr key={figure.key} className="border-t border-border align-top">
            <th scope="row" className="p-3 font-medium"><span className="block">{figure.label}</span><span className="block text-xs font-normal text-muted-foreground">{figure.help}</span>
              {week === openWeek && reportFigureLine(haven, figure.key, value => thursdayDisplay(figure.key, value)) && <span className="block text-xs font-normal">{reportFigureLine(haven, figure.key, value => thursdayDisplay(figure.key, value))}</span>}</th>
            <td className="p-3">{editable
              ? <Input aria-label={figure.label} inputMode={figure.money ? 'decimal' : 'numeric'} value={fields[figure.key]} disabled={busy} onChange={e => { const value = e.target.value; setFields(current => ({ ...current, [figure.key]: value })); setChanged(true); setMessage(''); }} />
              : <span className="tabular-nums">{thursdayDisplay(figure.key, saved?.values[figure.key])}</span>}
              {isRosterFieldKey(figure.key) && editable && week === openWeek && differsFromRoster(figure.key) !== null && <span className="mt-2 block space-y-1">
                <label htmlFor={`thursday-${figure.key}-reason`} className="block text-xs font-medium">Why is this different from the roster ({differsFromRoster(figure.key)})?</label>
                <select id={`thursday-${figure.key}-reason`} disabled={busy} value={rosterReasons[figure.key] ?? ''} className="block min-h-10 w-full max-w-xs rounded border border-border bg-background px-3 text-sm"
                  onChange={e => { const value = e.target.value; setRosterReasons(prev => ({ ...prev, [figure.key]: isOverrideReason(value, reasonOptions) ? value : undefined })); setChanged(true); setMessage(''); }}>
                  <option value="">{reasonOptions ? 'Choose a reason' : 'Reasons could not be loaded'}</option>{(reasonOptions ?? []).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </span>}
              {isRosterFieldKey(figure.key) && recordedConfirmationLine(saved?.roster_confirmations?.[figure.key]) && <span className="mt-1 block text-xs text-muted-foreground">{recordedConfirmationLine(saved?.roster_confirmations?.[figure.key])}</span>}</td>
            <td className="whitespace-nowrap p-3 tabular-nums">{comparison.monday}</td>
            <td className="whitespace-nowrap p-3 tabular-nums">{comparison.change ?? '—'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {editable && <>
      {historical && <label className="block text-sm font-medium">Why this past meeting is changing<textarea className="mt-1 block min-h-20 w-full rounded border border-border bg-background p-2 text-sm" value={reason} onChange={e => { setReason(e.target.value); }} /></label>}
      {(problem || parseError) && <p role="alert" className="text-sm text-destructive">{problem || parseError}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !changed} onClick={() => void save('draft')}>Save draft</Button>
        <Button disabled={busy || !complete || (!changed && saved?.status === 'ready')} onClick={() => void save('ready')}>Submit {MEETING_LABELS[day]} figures</Button>
        {changed && <Button variant="ghost" disabled={busy} onClick={() => { setFields(fieldsFor(saved?.values)); setChanged(false); setProblem(''); }}>Discard changes</Button>}
      </div>
      {!complete && !parseError && <p className="text-xs text-muted-foreground">Submitting needs all {THURSDAY_KEYS.length} figures. A draft can be saved with blanks.</p>}
    </>}
    {saved?.id && <MeetingRevisions day={day} facilityId={facility.id} week={week} version={saved.version} />}
  </section>;
}

function MeetingRevisions({ day, facilityId, week, version }: { day: MeetingDay; facilityId: string; week: string; version: number }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<MeetingHistory | null>(null);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setError('');
    try { setHistory(await standUpRequest<MeetingHistory>('revisions', { meeting_day: day, facility_id: facilityId, week_start: week })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisions could not be loaded.'); }
  };
  return <div>
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => void toggle()}>{open ? 'Hide history' : `History · ${version === 1 ? '1 revision' : `${version} revisions`}`}</Button>
    {open && <div className="mt-2 space-y-2 text-xs">
      {error && <p role="alert">{error}</p>}
      {!history && !error && <p role="status">Loading revisions…</p>}
      {history?.revisions.map(revision => <div key={revision.revision_id} className="border-l-2 border-border pl-2">
        <p className="font-medium">Revision {revision.version} · {meetingStamp(revision.created_at)} · {revision.updated_by_name ?? 'Unknown'} · {revision.status === 'ready' ? 'Submitted' : 'Draft saved'}{revision.revision_id === history.call_snapshot_revision_id ? ' · As of the call' : ''}{revision.reason ? ` · ${revision.reason}` : ''}</p>
        <p>{THURSDAY_FIGURES.map(figure => `${figure.label}: ${thursdayDisplay(figure.key, revision.values[figure.key])}`).join(' · ')}</p>
      </div>)}
    </div>}
  </div>;
}
