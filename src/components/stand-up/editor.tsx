'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerRouteLeaveGuard, supportsRouteLeaveProtection, standUpHasDocumentEntry, useRouteTransitionPending, isRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { METRICS, dateLabel, reportDeadlineState, derivedValues, dollars, easternTime, fieldState, metricDisplay, reportState, shiftDay, validateValues, FIELD_STATE_TEXT, type MetricKey, type StandUpReport, type StandUpValues } from '@/lib/stand-up/model';
import { legacyOvertimeToMinutes } from '@/lib/stand-up/duration';
import { EntryQuestions, entryValues, fieldsFor, type EntryFields } from './entry-fields';
import { StandUpHistory } from './history';
import { RecoveryTools } from './recovery';
import { StandUpRequestError, standUpRequest } from './transport';
import type { RecoveryPreview } from './types';

type Props = {
  facility: { id: string; name: string }; week: string; currentWeek: string;
  report?: StandUpReport; reports: StandUpReport[]; recoveries: RecoveryPreview[];
  canManage: boolean; userId: string; now: Date;
  onSaved: (report: StandUpReport) => void; onDenied: () => void; onReload: () => Promise<void>;
  bindGuard: (guard: (silent?: boolean) => boolean) => () => void;
};
type SaveAttempt = { payload: Record<string, unknown>; generation: number; status: 'draft' | 'ready' };

export function StandUpEditor(props: Props) {
  const routePending = useRouteTransitionPending();
  const { facility, week, currentWeek, canManage, onSaved, onDenied, onReload, bindGuard } = props;
  const [draft, setDraft] = useState(() => fieldsFor(props.report?.values));
  const [saved, setSaved] = useState(props.report);
  const [dirty, setDirty] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [correction, setCorrection] = useState(false);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [history, setHistory] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const mounted = useRef(true);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const reviewedBefore = useRef(false);
  useEffect(() => {
    if (review) { reviewedBefore.current = true; reviewHeading.current?.focus(); }
    else if (reviewedBefore.current) reviewButton.current?.focus();
  }, [review]);
  const draftRef = useRef(draft); const savedRef = useRef(saved);
  const generation = useRef(0); const dirtyRef = useRef(false);
  const savingRef = useRef(false); const pending = useRef<SaveAttempt | null>(null);
  const historical = week !== currentWeek;
  const [browserProtected, setBrowserProtected] = useState(() => supportsRouteLeaveProtection());
  useLayoutEffect(() => {
    const documentEntry = standUpHasDocumentEntry();
    if (documentEntry === true) setBrowserProtected(true);
    else if (documentEntry === false) window.location.replace(window.location.href);
  }, []);
  const editable = browserProtected && (!historical || (canManage && correction));
  // Historical figures stay readable but reject typing until a reasoned correction is opened.
  const readOnly = historical && !(canManage && correction);
  const guardState = useRef({ dirty, advancedBusy });
  useLayoutEffect(() => { guardState.current = { dirty, advancedBusy }; }, [dirty, advancedBusy]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const guard = (silent?: boolean) => {
      if (!dirtyRef.current && !savingRef.current && !pending.current && !guardState.current.advancedBusy) return true;
      if (!silent) setError(pending.current && !savingRef.current ? `Retry ${facility.name}'s save to recover its receipt before leaving, refreshing, or switching reports.` : savingRef.current || guardState.current.advancedBusy ? `Wait for ${facility.name}'s save or review to finish before leaving or switching.` : `Save or discard ${facility.name}'s unsaved changes before leaving or switching facility or meeting.`);
      return false;
    };
    const unbindScope = bindGuard(silent => { if (!isRouteTransitionPending()) return guard(silent); if (!silent) setError('A page is opening. Wait for navigation to finish before switching reports.'); return false; });
    const unbindRoute = registerRouteLeaveGuard(guard);
    return () => { unbindScope(); unbindRoute(); };
  }, [bindGuard, facility.name]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current || pending.current || guardState.current.advancedBusy) { event.preventDefault(); event.returnValue = ''; } };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('beforeunload', warn); window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, []);
  // A refreshed server version may reveal a change from another administrator or
  // browser tab. Never replace a draft that the operator is still editing.
  useEffect(() => {
    if (!props.report || props.report.version <= (savedRef.current?.version ?? 0) || savingRef.current || pending.current) return;
    if (dirtyRef.current) { setConflict(true); setError('This report changed elsewhere. Your entries are retained. Review the saved report before continuing.'); return; }
    savedRef.current = props.report; setSaved(props.report); draftRef.current = fieldsFor(props.report.values); setDraft(draftRef.current); pending.current = null; setReview(false);
  }, [props.report]);
  const save = useCallback(async (status: 'draft' | 'ready'): Promise<boolean> => {
    if (isRouteTransitionPending() || savingRef.current || !mounted.current || !editable || conflict || !navigator.onLine) return false;
    // A timeout has an unknown outcome. Retrieve the receipt for the exact same
    // request before sending any later edits or a submission.
    let attempt = pending.current;
    if (!attempt) {
      try {
        let invalidStoredDuration = !!savedRef.current?.overtime_issue;
        try { legacyOvertimeToMinutes(savedRef.current?.values.overtime_reported ?? null); } catch { invalidStoredDuration = true; }
        if (invalidStoredDuration && !draftRef.current.overtime_hours.trim() && !draftRef.current.overtime_minutes.trim()) throw new Error('Correct the saved overtime with explicit hours and minutes before saving.');
        const values = entryValues(draftRef.current);
        const issues = validateValues(values);
        if (issues.length) throw new Error(issues.join(' '));
        if (historical && !reason.trim()) throw new Error('Enter a reason for this historical correction.');
        if (status === 'ready' && derivedValues(values).completed_fields !== 16) throw new Error('Complete all sixteen figures before submitting. Use zero when there are none.');
        attempt = { generation: generation.current, status, payload: { facility_id: facility.id, week_start: week, expected_version: savedRef.current?.version ?? 0, values, status, ...(historical ? { reason: reason.trim() } : {}), request_id: crypto.randomUUID() } };
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check your figures.'); setPhase('failed'); return false; }
      pending.current = attempt;
    }
    savingRef.current = true; setPhase('saving'); setError('');
    try {
      const receipt = await standUpRequest<StandUpReport>('save', attempt.payload);
      if (!mounted.current) return false;
      if (receipt.facility_id !== facility.id || receipt.week_start !== week) throw new Error('The save receipt did not match this facility and meeting. Refresh reports before continuing.');
      savedRef.current = receipt; setSaved(receipt); pending.current = null; onSaved(receipt);
      const unchanged = generation.current === attempt.generation;
      dirtyRef.current = !unchanged; setDirty(!unchanged); setPhase('saved');
      if (unchanged) { draftRef.current = fieldsFor(receipt.values); setDraft(draftRef.current); }
      if (attempt.status === 'ready') setReview(false);
      return unchanged && attempt.status === status;
    } catch (cause) {
      if (!mounted.current) return false;
      setPhase('failed'); setReview(false);
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) { onDenied(); return false; }
      if (cause instanceof StandUpRequestError && [400, 413, 422].includes(cause.status)) pending.current = null;
      if (cause instanceof StandUpRequestError && cause.status === 409) { setConflict(true); pending.current = null; void onReload(); }
      setError(cause instanceof Error ? cause.message : 'Save failed. Your entries are retained. Retry to check the save result.');
      return false;
    } finally { if (mounted.current) { savingRef.current = false; } }
  }, [editable, conflict, historical, reason, facility.id, week, onSaved, onDenied, onReload]);
  useEffect(() => {
    if (!dirty || !online || review || historical || conflict || phase === 'saving' || phase === 'failed' || advancedBusy) return;
    const timer = window.setTimeout(() => void save('draft'), 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, online, review, historical, conflict, phase, advancedBusy, save]);
  const change = (key: keyof EntryFields, value: string) => {
    if (isRouteTransitionPending() || readOnly) return;
    generation.current++; draftRef.current = { ...draftRef.current, [key]: value }; setDraft(draftRef.current);
    dirtyRef.current = true; setDirty(true); setReview(false);
    // Invalid local input has no unknown server outcome, so a correction can
    // resume autosave. Network failures retain their request until manual retry.
    if (!pending.current && !conflict && !savingRef.current) { setPhase('idle'); setError(''); }
  };
  const discard = () => {
    if (savingRef.current || advancedBusy || pending.current) return;
    const latest = props.report && props.report.version > (savedRef.current?.version ?? 0) ? props.report : savedRef.current;
    generation.current++; savedRef.current = latest; setSaved(latest); draftRef.current = fieldsFor(latest?.values); setDraft(draftRef.current);
    dirtyRef.current = false; setDirty(false); setConflict(false); setError(''); setReview(false); setPhase('idle');
  };
  const acceptRecovery = (report: StandUpReport) => {
    if (!mounted.current || report.facility_id !== facility.id || report.week_start !== week) return;
    savedRef.current = report; setSaved(report); draftRef.current = fieldsFor(report.values); setDraft(draftRef.current); setPhase('saved'); onSaved(report);
  };
  let values: StandUpValues | undefined; let validationMessage = '';
  try { values = entryValues(draft); } catch (cause) { validationMessage = cause instanceof Error ? cause.message : 'Check the figures.'; }
  const complete = values ? derivedValues(values) : null;
  const missing = values ? METRICS.filter(metric => values[metric.key] === null) : [];
  const prior = props.reports.filter(report => report.facility_id === facility.id && report.week_start < week).sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
  const deadlineState = reportDeadlineState(saved, week, currentWeek, props.now);
  const isLate = deadlineState === 'past_target';
  const easternParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(props.now);
  const easternPart = (type: string) => easternParts.find(part => part.type === type)!.value;
  const staffingClosed = `${easternPart('year')}-${easternPart('month')}-${easternPart('day')}` >= week;
  let durationNeedsReview = !!saved?.overtime_issue;
  try { legacyOvertimeToMinutes(saved?.values.overtime_reported ?? null); } catch { durationNeedsReview = true; }
  // The save path refuses every save, including autosave of other figures, while the stored notation is unreadable.
  const overtimeError = durationNeedsReview && saved ? { id: 'overtime-review', message: `The saved overtime notation ${saved.values.overtime_reported} needs review. Enter hours and minutes. Until then this report cannot be saved, including autosave of other figures, or submitted.` } : undefined;
  // A blank in review that is still a held import says so, so the administrator knows why it is blank.
  const reviewDisplay = (key: MetricKey) => values && values[key] === null && fieldState(saved, key) === 'held_unit_unconfirmed' ? FIELD_STATE_TEXT.held_unit_unconfirmed : values ? metricDisplay(key, values[key]) : '';
  const saveText = !online ? 'Offline — changes stay in this open page' : phase === 'saving' ? 'Saving…' : phase === 'failed' ? 'Not saved — retry required' : dirty ? 'Unsaved changes' : saved ? `Saved ${easternTime(saved.updated_at)} Eastern` : 'No saved report yet';
  return <section aria-label={`${facility.name} entry`} className="space-y-5">
    {!browserProtected && <p role="alert" className="rounded border border-border p-3 text-sm">To enter figures safely, open Haven in an up-to-date Chrome, Edge, Firefox, or Safari browser. Haven could not establish a protected document entry in this browser. Saved reports remain available.</p>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-medium">{dirty && (saved?.last_submitted_at || saved?.status === 'ready') ? 'Changes awaiting resubmission' : reportState(saved)}</p><p className="mt-1 text-sm text-muted-foreground">{saved?.last_submitted_at ? `Last submitted ${easternTime(saved.last_submitted_at)} Eastern.` : 'Review and submit when your figures are complete.'}{isLate ? ' The 8:45 a.m. Haven submission target has passed; you can still finish or correct this report.' : deadlineState === 'timing_unknown' ? ' Submission timing was not recorded for this imported or earlier report.' : ''}</p></div>
      {prior && <Button variant="ghost" onClick={() => setHistory(value => !value)} aria-expanded={history}>Report history</Button>}
    </div>
    {saved?.entry_origin === 'imported' && !saved.last_submitted_at && <p className="border-l-2 border-border pl-3 text-sm">These figures were imported from the workbook. Check every section before submitting; filled fields do not mean administrator review is complete.</p>}
    {overtimeError && <p role="alert" className="rounded border border-destructive p-3">{overtimeError.message}</p>}
    {!online && <p role="status" className="rounded border border-border p-3 text-sm">Haven is offline. Keep this page open to retain unsaved entries. The shared Google workbook is your outage fallback while Drive is available.</p>}
    {historical && <section className="space-y-2 rounded border border-border p-4"><h3 className="font-medium">Historical report — {dateLabel(week)}</h3><p className="text-sm">Previous meetings are preserved. This is not the open reporting period.{readOnly ? ' Figures are read-only.' : ''}</p>{canManage && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={correction} disabled={routePending || phase === 'saving' || dirty || !!pending.current} onChange={event => setCorrection(event.target.checked)} /> Make a correction with a recorded reason</label>}</section>}
    {history && <StandUpHistory reports={props.reports} facilityId={facility.id} facilityName={facility.name} />}
    {review && values ? <section aria-label="Review report" className="space-y-4 rounded border border-border p-5">
      <h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold outline-none">Review {facility.name} · {dateLabel(week)}</h3><p className="text-sm text-muted-foreground">Check the destination, period and all sixteen figures. Submission confirms your review; payroll verification is separate.</p>
      {missing.length > 0 && <p role="alert">Still needed: {missing.map(metric => metric.label).join(', ')}.</p>}
      <dl className="grid gap-x-8 sm:grid-cols-2">{METRICS.map(metric => <div key={metric.key} className="flex justify-between gap-3 border-b border-border py-3 text-sm"><dt>{metric.label}</dt><dd className="whitespace-nowrap font-medium tabular-nums">{reviewDisplay(metric.key)}</dd></div>)}</dl>
      {!staffingClosed && <p className="text-sm">Sunday preparation stays a draft until the Monday–Sunday payroll period has closed.</p>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setReview(false)}>Back to figures</Button><Button className="h-auto min-h-10 whitespace-normal text-left" disabled={routePending || !online || phase === 'saving' || advancedBusy || complete?.completed_fields !== 16 || !staffingClosed} onClick={() => void save('ready')}>Submit {facility.name} for {dateLabel(week)}</Button></div>
    </section> : <form noValidate id="stand-up-entry" className="space-y-5" onSubmit={event => { event.preventDefault(); void save('draft'); }}>
      <p className="text-sm text-muted-foreground">Leave a figure blank if it is not yet known. Enter 0 when there are none.</p>
      {prior && <p className="text-xs text-muted-foreground">Reference figures below are from {dateLabel(prior.week_start)}{prior.week_start !== shiftDay(week, -7) ? '; the previous calendar week is missing' : ', the previous reporting week'}. They are not copied into this report.</p>}
      <EntryQuestions fields={draft} onChange={change} disabled={!browserProtected || advancedBusy || conflict || routePending} readOnly={readOnly} week={week} prior={prior} priorWeek={prior ? dateLabel(prior.week_start) : undefined} overtimeError={overtimeError} />
      {historical && correction && <label htmlFor="correction-reason" className="block text-sm font-medium">Correction reason<Input id="correction-reason" value={reason} disabled={routePending || phase === 'saving'} onChange={event => setReason(event.target.value)} required className="mt-2" /></label>}
    </form>}
    <section aria-label="Save and submit report" className="sticky bottom-0 z-10 space-y-3 border-y border-border bg-background px-1 py-4 shadow-sm">
      {error && <div role="alert" className="rounded border border-destructive p-3 text-sm">{error}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="font-semibold">{facility.name} · {dateLabel(week)}</p><p role="status" className="mt-1 text-sm">{routePending ? 'Opening page — editing paused' : saveText}</p>{saved?.updated_by_name && <p className="mt-1 text-xs text-muted-foreground">Last saved by {saved.updated_by === props.userId ? 'you' : saved.updated_by_name}</p>}<p className="mt-1 text-xs text-muted-foreground">{complete?.completed_fields ?? '—'}/16 provided · Open beds: {complete?.total_beds_open ?? FIELD_STATE_TEXT.not_provided} · Average rent: {dollars(complete?.average_rent_cents ?? null)}</p></div>
        {!review && <div className="flex flex-wrap gap-2"><Button type="submit" form="stand-up-entry" variant="outline" disabled={routePending || !online || !editable || phase === 'saving' || advancedBusy || conflict || (!dirty && !pending.current)}>{phase === 'failed' ? 'Retry save' : 'Save draft'}</Button><Button ref={reviewButton} disabled={routePending || !editable || !online || phase === 'saving' || advancedBusy || conflict || !!pending.current} onClick={() => { if (validationMessage) { setError(validationMessage); return; } setReview(true); }}>Review and submit</Button></div>}
      </div>
      {(dirty || conflict) && <Button variant="ghost" disabled={routePending || phase === 'saving' || advancedBusy || !!pending.current} onClick={discard}>{conflict ? 'Discard my edits and load saved figures' : 'Discard unsaved changes'}</Button>}
      {pending.current && phase === 'failed' && <p className="text-xs text-muted-foreground">The save result is uncertain. Retry the same save to recover its receipt before switching or discarding.</p>}
    </section>
    <section className="space-y-3 border-t border-border pt-4"><Button variant="ghost" disabled={routePending || advancedBusy || !!pending.current} aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen(value => !value)}>{props.recoveries.length ? `${props.recoveries.length} spreadsheet ${props.recoveries.length === 1 ? 'change needs' : 'changes need'} review` : 'Spreadsheet recovery and backup'}</Button>{recoveryOpen && <RecoveryTools facility={facility} week={week} report={saved} recoveries={props.recoveries} disabled={routePending || dirty || phase === 'saving' || !!pending.current || !editable} onSaved={acceptRecovery} onBusy={value => { guardState.current.advancedBusy = value; setAdvancedBusy(value); }} onDenied={onDenied} onReload={props.onReload} />}</section>
  </section>;
}
