'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerRouteLeaveGuard, supportsRouteLeaveProtection, standUpHasDocumentEntry, useRouteTransitionPending, isRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { METRICS, SECTIONS, emptyValues, wallClockMinutes, DEFAULT_MONDAY_TIMES, type MondayTimes, dateLabel, entryOpensStamp, getStandUpEntryWindow, reportDeadlineState, derivedValues, easternTime, fieldState, metricDisplay, sectionMetrics, sectionPeriodLabel, staffingPeriod, shiftDay, validateValues, FIELD_STATE_TEXT, type MetricKey, type StandUpReport, type StandUpValues } from '@/lib/stand-up/model';
import { changesFromPrevious, lastSaveLine, reportStatus, snapshotAsOf, submissionChecklist, submissionEvidence } from '@/lib/stand-up/report-presentation';
import { REPORTING_QUALIFICATION, UNCHECKED_KEYS, uncheckedNote } from '@/lib/stand-up/field-definitions';
import { legacyOvertimeToMinutes } from '@/lib/stand-up/duration';
import { ROSTER_FIELD_KEYS, expectedSource, rosterSuggestion, type OverrideReason, type RosterCensus, type RosterFieldKey, type RosterPayload } from '@/lib/stand-up/roster-census';
import { EntryQuestions, SectionNav, entryValues, fieldsFor, rosterIssueMessage, type EntryFields, type PrefillEntry, type RosterEntry } from './entry-fields';
import { PREFILL_KEYS, expectedPrefillSource, prefillIssueMessage, prefillIssues, prefillValue, prefilledValues, type MondayPrefill, type PrefillKey, type PrefillOverrideReason, type PrefillPayload } from '@/lib/stand-up/prefill';
import { PostSubmitHistory, StandUpHistory } from './history';
import { OutOfHousePanel } from './out-of-house';
import { RecoveryTools } from './recovery';
import { StandUpRequestError, standUpRequest } from './transport';
import type { RecoveryPreview } from './types';
import { CensusDisagreementChips, loadCensusDisagreements } from './CensusDisagreementChip';
import { ReconcileDialog } from './ReconcileDialog';
import { showsChip, type CensusDisagreement } from '@/lib/stand-up/census-disagreement';

type Props = {
  facility: { id: string; name: string }; week: string; currentWeek: string;
  /** This facility's entry-open lead; null means the Haven default. */
  leadMinutes?: number | null;
  report?: StandUpReport; reports: StandUpReport[]; recoveries: RecoveryPreview[];
  canManage: boolean; userId: string; now: Date;
  /** COL-797: owner, org_admin or facility_admin may change a week after it was submitted. */
  canEditSubmitted?: boolean;
  /** COL-555: opened from a Reconcile link; show the dialog once the disagreement is read. */
  autoReconcile?: boolean;
  /** COL-805: Monday's deadline and call from the schedule. */
  times?: MondayTimes;
  onSaved: (report: StandUpReport) => void; onDenied: () => void; onReload: () => Promise<void>;
  bindGuard: (guard: (silent?: boolean) => boolean) => () => void;
};
type SaveAttempt = { payload: Record<string, unknown>; generation: number; status: 'draft' | 'ready' };
type Reasons = Partial<Record<RosterFieldKey, OverrideReason>>;

/** A typed figure that differs from the roster needs a reason before any save, including autosave. */
function rosterIssues(values: StandUpValues, roster: RosterCensus | undefined, reasons: Reasons): Partial<Record<RosterFieldKey, string>> {
  const issues: Partial<Record<RosterFieldKey, string>> = {};
  if (!roster) return issues;
  for (const key of ROSTER_FIELD_KEYS) {
    if (expectedSource(roster, key, values[key]) === 'overridden' && !reasons[key]) issues[key] = rosterIssueMessage(key, rosterSuggestion(roster, key)!);
  }
  return issues;
}

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
  // COL-797: a submitted report stays read-only until someone allowed to change it reopens it.
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [history, setHistory] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  // Roster suggestion for the open period. It is read, never written into a figure.
  const [roster, setRoster] = useState<RosterCensus | undefined>(undefined);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [reasons, setReasons] = useState<Reasons>({});
  const [rosterTick, setRosterTick] = useState(0);
  // COL-753: Haven's own figures for the open period. Read, never saved on their own.
  const [prefill, setPrefill] = useState<MondayPrefill | undefined>(undefined);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillError, setPrefillError] = useState('');
  const [prefillReasons, setPrefillReasons] = useState<Partial<Record<PrefillKey, PrefillOverrideReason>>>({});
  const prefillRef = useRef(prefill); const prefillReasonsRef = useRef(prefillReasons);
  const prefillApplied = useRef(false);
  // COL-555: the census disagreement for this report, and its Reconcile dialog.
  const [reconcileTarget, setReconcileTarget] = useState<CensusDisagreement | null>(null);
  const [disagreementTick, setDisagreementTick] = useState(0);
  const rosterRef = useRef(roster); const reasonsRef = useRef(reasons);
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
  // One window model decides all three states of this page: a meeting whose
  // entry has not opened yet, the open reporting period, and a past meeting.
  const times = props.times ?? DEFAULT_MONDAY_TIMES;
  const entryWindow = getStandUpEntryWindow({ meetingMonday: week, leadMinutes: props.leadMinutes, now: props.now, times });
  const notOpen = entryWindow.state === 'not_open';
  const historical = week < currentWeek;
  // Roster suggestions belong to a report that can be entered now. A past
  // meeting and a meeting that has not opened are both outside that.
  const entering = !historical && !notOpen;
  const [browserProtected, setBrowserProtected] = useState(() => supportsRouteLeaveProtection());
  useLayoutEffect(() => {
    const documentEntry = standUpHasDocumentEntry();
    if (documentEntry === true) setBrowserProtected(true);
    else if (documentEntry === false) window.location.replace(window.location.href);
  }, []);
  // COL-797: the submitter and facility administrators may reopen a submitted
  // week, including a past one. The server makes the same decision.
  const wasSubmitted = !!saved?.last_submitted_at || saved?.status === 'ready';
  const mayEditSubmitted = wasSubmitted && (!!props.canEditSubmitted || (!!saved?.last_submitted_by && saved.last_submitted_by === props.userId));
  const reopened = mayEditSubmitted && editingSubmitted;
  const lockedSubmitted = saved?.status === 'ready' && !reopened && !(historical && canManage && correction);
  const historicalOpen = (canManage && correction) || reopened;
  const editable = browserProtected && !notOpen && !lockedSubmitted && (!historical || historicalOpen);
  // Figures stay readable but reject typing: before the window opens for anyone,
  // on a past meeting until a reasoned correction is opened, and on a submitted
  // report until it is reopened.
  const readOnly = notOpen || lockedSubmitted || (historical && !historicalOpen);
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
  // The roster is re-read on mount, on page focus and after each save; never on a timer or a channel.
  const loadRoster = useCallback(async () => {
    if (!entering) return;
    setRosterLoading(true);
    try {
      const data = await standUpRequest<RosterCensus>('roster', { facility_id: facility.id });
      if (!mounted.current) return;
      if (data.facility_id !== facility.id) throw new Error('The roster response did not match this facility.');
      rosterRef.current = data; setRoster(data); setRosterError(''); setRosterTick(tick => tick + 1);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) { onDenied(); return; }
      rosterRef.current = undefined; setRoster(undefined); setRosterError(cause instanceof Error ? cause.message : 'The roster could not be read.');
    } finally { if (mounted.current) setRosterLoading(false); }
  }, [entering, facility.id, onDenied]);
  const loadPrefill = useCallback(async () => {
    if (!entering) return;
    setPrefillLoading(true);
    try {
      const data = await standUpRequest<MondayPrefill>('prefill', { facility_id: facility.id });
      if (!mounted.current) return;
      if (data.facility_id !== facility.id || data.week_start !== week) throw new Error('Haven’s figures did not match this facility and meeting.');
      prefillRef.current = data; setPrefill(data); setPrefillError('');
      // A report nobody has started opens with Haven's figures, for the
      // administrator to verify. Nothing is saved until they save or submit,
      // and a figure Haven cannot compute stays blank, never 0.
      if (!prefillApplied.current && !savedRef.current && !dirtyRef.current && !pending.current && Object.values(draftRef.current).every(value => value.trim() === '')) {
        prefillApplied.current = true;
        draftRef.current = fieldsFor(prefilledValues(data, emptyValues())); setDraft(draftRef.current);
      }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) { onDenied(); return; }
      prefillRef.current = undefined; setPrefill(undefined); setPrefillError(cause instanceof Error ? cause.message : 'Haven’s figures could not be read.');
    } finally { if (mounted.current) setPrefillLoading(false); }
  }, [entering, facility.id, week, onDenied]);
  useEffect(() => {
    void loadRoster(); void loadPrefill();
    const focus = () => { void loadRoster(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [loadRoster, loadPrefill]);
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
        const blocked = Object.values(rosterIssues(values, entering ? rosterRef.current : undefined, reasonsRef.current));
        if (blocked.length) throw new Error(blocked.join(' '));
        // COL-753: a draft may keep a figure that differs from Haven; submitting it needs the reason.
        const unexplained = status === 'ready' && entering ? prefillIssues(prefillRef.current, values, prefillReasonsRef.current) : [];
        if (unexplained.length) throw new Error(unexplained.map(key => prefillIssueMessage(METRICS.find(metric => metric.key === key)!.label, key, prefillValue(prefillRef.current, key)!)).join(' '));
        const prefillBlock: PrefillPayload | undefined = entering && prefillRef.current ? Object.fromEntries((PREFILL_KEYS as PrefillKey[])
          .filter(key => expectedPrefillSource(prefillRef.current, key, values[key]) === 'overridden' && prefillReasonsRef.current[key])
          .map(key => [key, { override_reason: prefillReasonsRef.current[key]! }])) as PrefillPayload : undefined;
        // The roster block carries only the chosen reasons; the server recomputes the suggestion and decides the source.
        const rosterBlock: RosterPayload | undefined = entering && rosterRef.current ? Object.fromEntries(ROSTER_FIELD_KEYS.map(key => [key, expectedSource(rosterRef.current, key, values[key]) === 'overridden' && reasonsRef.current[key] ? { override_reason: reasonsRef.current[key] } : {}])) as RosterPayload : undefined;
        attempt = { generation: generation.current, status, payload: { facility_id: facility.id, week_start: week, expected_version: savedRef.current?.version ?? 0, values, status, ...(historical || (reopened && reason.trim()) ? { reason: reason.trim() } : {}), ...(rosterBlock ? { roster: rosterBlock } : {}), ...(prefillBlock && Object.keys(prefillBlock).length ? { prefill: prefillBlock } : {}), request_id: crypto.randomUUID() } };
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check your figures.'); setPhase('failed'); return false; }
      pending.current = attempt;
    }
    savingRef.current = true; setPhase('saving'); setError('');
    try {
      const receipt = await standUpRequest<StandUpReport>('save', attempt.payload);
      if (!mounted.current) return false;
      if (receipt.facility_id !== facility.id || receipt.week_start !== week) throw new Error('The save receipt did not match this facility and meeting. Refresh reports before continuing.');
      // COL-298: a save that carried no figures reserves nothing, so there is no
      // report to hold on to. The next save starts from version 0 again.
      const stored = receipt.not_started ? undefined : receipt;
      savedRef.current = stored; setSaved(stored); pending.current = null; onSaved(receipt);
      const unchanged = generation.current === attempt.generation;
      dirtyRef.current = !unchanged; setDirty(!unchanged); setPhase('saved');
      if (unchanged) { draftRef.current = fieldsFor(receipt.values); setDraft(draftRef.current); }
      if (attempt.status === 'ready') setReview(false);
      if (rosterRef.current) void loadRoster();
      if (prefillRef.current) void loadPrefill();
      return unchanged && attempt.status === status;
    } catch (cause) {
      if (!mounted.current) return false;
      setPhase('failed'); setReview(false);
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) { onDenied(); return false; }
      if (cause instanceof StandUpRequestError && [400, 413, 422].includes(cause.status)) pending.current = null;
      // The roster moved between the suggestion and the save: read it again so the reason control appears.
      if (cause instanceof StandUpRequestError && cause.status === 400 && /differs from the Haven roster/.test(cause.message)) void loadRoster();
      if (cause instanceof StandUpRequestError && cause.status === 400 && /differs from Haven \(/.test(cause.message)) void loadPrefill();
      if (cause instanceof StandUpRequestError && cause.status === 409) { setConflict(true); pending.current = null; void onReload(); }
      setError(cause instanceof Error ? cause.message : 'Save failed. Your entries are retained. Retry to check the save result.');
      return false;
    } finally { if (mounted.current) { savingRef.current = false; } }
  }, [editable, conflict, historical, reopened, entering, reason, facility.id, week, onSaved, onDenied, onReload, loadRoster, loadPrefill]);
  let values: StandUpValues | undefined; let validationMessage = '';
  try { values = entryValues(draft); } catch (cause) { validationMessage = cause instanceof Error ? cause.message : 'Check the figures.'; }
  const rosterBlocked = values && entering ? Object.keys(rosterIssues(values, roster, reasons)).length > 0 : false;
  useEffect(() => {
    if (!dirty || !online || review || !entering || conflict || phase === 'saving' || phase === 'failed' || advancedBusy || rosterBlocked) return;
    const timer = window.setTimeout(() => void save('draft'), 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, online, review, entering, conflict, phase, advancedBusy, rosterBlocked, save]);
  const change = (key: keyof EntryFields, value: string) => {
    if (isRouteTransitionPending() || readOnly) return;
    generation.current++; draftRef.current = { ...draftRef.current, [key]: value }; setDraft(draftRef.current);
    dirtyRef.current = true; setDirty(true); setReview(false);
    // Invalid local input has no unknown server outcome, so a correction can
    // resume autosave. Network failures retain their request until manual retry.
    if (!pending.current && !conflict && !savingRef.current) { setPhase('idle'); setError(''); }
  };
  const setRosterReason = (key: RosterFieldKey, value: OverrideReason | null) => {
    const next = { ...reasonsRef.current }; if (value) next[key] = value; else delete next[key];
    reasonsRef.current = next; setReasons(next);
    if (phase === 'failed' && !pending.current) { setPhase('idle'); setError(''); }
  };
  const applyRoster = (key: RosterFieldKey) => {
    const suggested = rosterSuggestion(rosterRef.current, key);
    if (suggested === null) return;
    setRosterReason(key, null); change(key, String(suggested));
  };
  const setPrefillReason = (key: PrefillKey, value: PrefillOverrideReason | null) => {
    const next = { ...prefillReasonsRef.current }; if (value) next[key] = value; else delete next[key];
    prefillReasonsRef.current = next; setPrefillReasons(next);
    if (phase === 'failed' && !pending.current) { setPhase('idle'); setError(''); }
  };
  const applyPrefill = (key: PrefillKey) => {
    const haven = prefillValue(prefillRef.current, key);
    if (haven === null) return;
    setPrefillReason(key, null); change(key, String(key === 'monthly_rent_roll_cents' ? haven / 100 : haven));
  };
  useEffect(() => {
    if (!props.autoReconcile || !entering) return;
    let live = true;
    void loadCensusDisagreements(facility.id).then(rows => {
      const row = rows?.find(item => item.meeting_day === 'monday' && item.facility_id === facility.id && showsChip(item));
      if (live && row) setReconcileTarget(row);
    });
    return () => { live = false; };
  }, [props.autoReconcile, entering, facility.id]);
  const prefillEntry: PrefillEntry | undefined = !entering ? undefined : { data: prefill, loading: prefillLoading, error: prefillError, reasons: prefillReasons, onReason: setPrefillReason, onUsePrefill: applyPrefill };
  const rosterEntry: RosterEntry | undefined = !entering ? undefined : { data: roster, loading: rosterLoading, error: rosterError, reasons, onReason: setRosterReason, onUseRoster: applyRoster };
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
  const complete = values ? derivedValues(values) : null;
  const missing = values ? METRICS.filter(metric => values[metric.key] === null) : [];
  const prior = props.reports.filter(report => report.facility_id === facility.id && report.week_start < week).sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
  const deadlineState = reportDeadlineState(saved, week, currentWeek, props.now, times);
  const isLate = deadlineState === 'past_target';
  // The Monday-to-Sunday payroll week closes at the meeting Monday's midnight.
  const staffingClosed = props.now >= entryWindow.staffingPeriodEnd;
  let durationNeedsReview = !!saved?.overtime_issue;
  try { legacyOvertimeToMinutes(saved?.values.overtime_reported ?? null); } catch { durationNeedsReview = true; }
  // The save path refuses every save, including autosave of other figures, while the stored notation is unreadable.
  const overtimeError = durationNeedsReview && saved ? { id: 'overtime-review', message: `The saved overtime notation ${saved.values.overtime_reported} needs review. Enter hours and minutes. Until then this report cannot be saved, including autosave of other figures, or submitted.` } : undefined;
  // A blank in review that is still a held import says so, so the administrator knows why it is blank.
  const reviewDisplay = (key: MetricKey) => values && values[key] === null && fieldState(saved, key) === 'held_unit_unconfirmed' ? FIELD_STATE_TEXT.held_unit_unconfirmed : values ? metricDisplay(key, values[key]) : '';
  const saveText = !online ? 'Offline — changes stay in this open page' : phase === 'saving' ? 'Saving…' : phase === 'failed' ? 'Not saved — retry required' : dirty ? 'Unsaved changes' : saved ? `Saved ${easternTime(saved.updated_at)} Eastern · no unsaved changes` : 'No saved report yet';
  const status = reportStatus(saved, dirty);
  const asOf = snapshotAsOf(saved);
  const changes = values ? changesFromPrevious(values, prior) : [];
  return <section aria-label={`${facility.name} entry`} className="space-y-5">
    {!browserProtected && <p role="alert" className="rounded border border-border p-3 text-sm">To enter figures safely, open Haven in an up-to-date Chrome, Edge, Firefox, or Safari browser. Haven could not establish a protected document entry in this browser. Saved reports remain available.</p>}
    {/* Status, submission evidence and last save are three different facts and
        stay on three lines. The provenance an administrator needs to judge these
        figures is here, at the top, not only in the action bar at the bottom.
        Reporting timings that are not needed while entering a figure sit one
        disclosure down rather than filling the first screen. */}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-medium"><span>{status.state}</span>{status.qualifier && <span> · {status.qualifier}</span>}</p>
        <p className="mt-1 text-sm text-muted-foreground">{lastSaveLine(saved, props.userId)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{submissionEvidence(saved)}</p>
        {entering && !saved && prefillApplied.current && <p className="mt-1 text-sm">Prefilled from Haven. Check each figure against what you know, change any that are wrong, then submit.</p>}
        {isLate && <p className="mt-1 text-sm">The {wallClockMinutes(times.dueMinutes)} Haven submission target has passed; you can still finish or correct this report.</p>}
        {/* One line for a report nobody can enter yet, so the aide reading it at
            11:30 p.m. knows exactly when it opens rather than why saving failed. */}
        {notOpen && <p role="status" className="mt-1 text-sm">This report opens {entryOpensStamp(week, props.leadMinutes, times)}.</p>}
        {/* Open, but the payroll week has not closed: name what is still moving. */}
        {entering && !staffingClosed && <p className="mt-1 text-sm">Staffing and payroll run through Sunday 11:59 p.m. Update overtime and callouts before you submit.</p>}
      </div>
      {prior && <Button variant="ghost" onClick={() => setHistory(value => !value)} aria-expanded={history}>Report history</Button>}
    </div>
    <details className="text-sm">
      <summary className="cursor-pointer rounded text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Reporting periods and timings</summary>
      <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 text-sm text-muted-foreground">
        <li>Staffing and payroll covers {staffingPeriod(week)}.</li>
        {entering && <li>The next Monday report opens {entryOpensStamp(shiftDay(currentWeek, 7), props.leadMinutes, times)}.</li>}
        {prior && <li>Previous figures come from the report for {dateLabel(prior.week_start)}{prior.week_start !== shiftDay(week, -7) ? ', because the previous calendar week is missing' : ''}, and are not copied into this one.</li>}
      </ul>
    </details>
    {saved?.entry_origin === 'imported' && !saved.last_submitted_at && <p className="border-l-2 border-border pl-3 text-sm">These figures came from a historical import, not from entry in Haven. Check every section before submitting; filled fields do not mean administrator review is complete.</p>}
    {entering && <CensusDisagreementChips facilityId={facility.id} meetingDay="monday" refreshKey={`${saved?.version ?? 'new'}:${rosterTick}:${disagreementTick}`}
      action={d => <Button variant="outline" size="sm" onClick={() => setReconcileTarget(d)}>Reconcile</Button>} />}
    {reconcileTarget && <ReconcileDialog disagreement={reconcileTarget} open onOpenChange={open => { if (!open) setReconcileTarget(null); }} canChange={editable && !readOnly}
      onUseRoster={figure => applyRoster(figure.key)}
      onExplain={(figure, why) => { setRosterReason(figure.key, why); void save('draft').then(() => setDisagreementTick(tick => tick + 1)); }}
      onCheckAgain={() => { void loadRoster(); setDisagreementTick(tick => tick + 1); setReconcileTarget(null); }} />}
    {overtimeError && <p role="alert" className="rounded border border-destructive p-3">{overtimeError.message}</p>}
    {!online && <p role="status" className="rounded border border-border p-3 text-sm">Haven is offline. Keep this page open to retain unsaved entries. The shared Google workbook is your outage fallback while Drive is available.</p>}
    {historical && <section className="space-y-2 rounded border border-border p-4"><h3 className="font-medium">Historical report — {dateLabel(week)}</h3><p className="text-sm">Previous meetings are preserved. This is not the open reporting period.{readOnly ? ' Figures are read-only.' : ''}</p>{canManage && !mayEditSubmitted && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={correction} disabled={routePending || phase === 'saving' || dirty || !!pending.current} onChange={event => setCorrection(event.target.checked)} /> Make a correction with a recorded reason</label>}</section>}
    {wasSubmitted && <section aria-label="Submitted report" className="space-y-2 rounded border border-border p-4">
      {mayEditSubmitted && !reopened && (lockedSubmitted || historical) && <>
        <p className="text-sm">This report was submitted. To change a figure, reopen it: the figures you keep stay as they are, your changes save as a draft until you submit again, and every changed figure is recorded with your name, the time, and its old and new value.</p>
        <Button variant="outline" disabled={routePending || phase === 'saving' || !!pending.current || advancedBusy} onClick={() => setEditingSubmitted(true)}>Edit submitted figures</Button>
      </>}
      {lockedSubmitted && !mayEditSubmitted && <p className="text-sm">This report was submitted. Only the person who submitted it or a facility administrator can change it.</p>}
      {reopened && <p role="status" className="text-sm">Reopened for changes. Every changed figure is recorded in the edit history. Submit again when you are done.</p>}
      {mayEditSubmitted && saved?.version != null && <PostSubmitHistory facilityId={facility.id} week={week} version={saved.version} />}
    </section>}
    {history && <StandUpHistory reports={props.reports} facilityId={facility.id} facilityName={facility.name} />}
    {review && values ? <section aria-label="Review report" className="space-y-4 rounded border border-border p-5">
      <h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold outline-none">Review {facility.name} · {dateLabel(week)}</h3><p className="text-sm text-muted-foreground">Check the destination, period and all sixteen figures. Submission confirms your review; payroll verification is separate.</p>
      <p className="text-sm text-muted-foreground">{lastSaveLine(saved, props.userId)}</p>
      {/* Four separate facts. Populated figures are not a review, a review is
          not a settled counting rule, and none of them is a submission. */}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {submissionChecklist({ report: saved, dirty, provided: complete?.completed_fields ?? null, total: METRICS.length, unchecked: UNCHECKED_KEYS.length }).map(row =>
          <div key={row.term} className="contents"><dt className="font-medium">{row.term}</dt><dd className="text-muted-foreground">{row.detail}</dd></div>)}
      </dl>
      {missing.length > 0 && <p role="alert">Still needed: {missing.map(metric => metric.label).join(', ')}.</p>}
      {dirty && <p role="status" className="text-sm">Unsaved changes on this page are included when you submit.</p>}
      {/* Values stay grouped under the period they describe, so a forecast is
          never read as a result of the completed week. */}
      {SECTIONS.map(section => <div key={section.key} className="space-y-1">
        <h4 className="text-sm font-semibold">{section.label}</h4>
        <p className="text-xs text-muted-foreground">{sectionPeriodLabel(section, week, asOf, entering)}</p>
        <dl className="grid gap-x-8 sm:grid-cols-2">{sectionMetrics(section.key).map(metric => <div key={metric.key} className="flex justify-between gap-3 border-b border-border py-3 text-sm"><dt>{metric.label}</dt><dd className="whitespace-nowrap font-medium tabular-nums">{reviewDisplay(metric.key)}</dd></div>)}</dl>
      </div>)}
      {prior && <div className="space-y-1"><h4 className="text-sm font-semibold">Different from the previous report · {dateLabel(prior.week_start)}</h4>
        {changes.length ? <ul className="text-sm text-muted-foreground">{changes.map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">Every figure matches the previous report.</p>}</div>}
      {!staffingClosed && <p className="text-sm">Sunday preparation stays a draft until the Monday–Sunday payroll period has closed.</p>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setReview(false)}>Back to figures</Button><Button className="h-auto min-h-10 whitespace-normal text-left" disabled={routePending || !online || phase === 'saving' || advancedBusy || complete?.completed_fields !== 16 || !staffingClosed} onClick={() => void save('ready')}>Submit {facility.name} for {dateLabel(week)}</Button></div>
    </section> : <form noValidate id="stand-up-entry" className="space-y-5" onSubmit={event => { event.preventDefault(); void save('draft'); }}>
      <p className="text-sm text-muted-foreground">Leave a figure blank if it is not yet known. Enter 0 when there are none.</p>
      {/* Figures Haven cannot check are one qualification on the whole report,
          named once with every figure it touches, rather than a note repeated
          under each input. */}
      {UNCHECKED_KEYS.length > 0 && <details className="rounded border border-border p-3 text-sm">
        <summary className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Haven cannot check {UNCHECKED_KEYS.length} of the sixteen figures</summary>
        <p className="mt-2 text-sm text-muted-foreground">{REPORTING_QUALIFICATION}</p>
        <dl className="mt-3 space-y-2 border-l-2 border-border pl-3 text-xs">
          {UNCHECKED_KEYS.map(key => <div key={key}>
            <dt className="font-medium">{METRICS.find(metric => metric.key === key)!.label}</dt>
            <dd className="text-muted-foreground">{uncheckedNote(key)}</dd>
          </div>)}
        </dl>
      </details>}
      <SectionNav />
      <EntryQuestions fields={draft} onChange={change} disabled={!browserProtected || advancedBusy || conflict || routePending} readOnly={readOnly} week={week} open={entering} prior={prior} asOf={asOf} derived={complete} overtimeError={overtimeError}
        roster={rosterEntry} recorded={saved?.roster_confirmations} prefill={prefillEntry} recordedPrefill={saved?.prefill_confirmations} censusExtra={entering ? <OutOfHousePanel facilityId={facility.id} facilityName={facility.name} refreshKey={rosterTick} /> : undefined} />
      {!historical && reopened && <label htmlFor="change-reason" className="block text-sm font-medium">Reason for the change (optional)<Input id="change-reason" value={reason} disabled={routePending || phase === 'saving'} onChange={event => setReason(event.target.value)} className="mt-2" /></label>}
      {historical && historicalOpen && <label htmlFor="correction-reason" className="block text-sm font-medium">Correction reason<Input id="correction-reason" value={reason} disabled={routePending || phase === 'saving'} onChange={event => setReason(event.target.value)} required className="mt-2" /></label>}
    </form>}
    <section aria-label="Save and submit report" className="sticky bottom-0 z-10 space-y-2 border-y border-border bg-background px-1 py-2 shadow-sm sm:space-y-3 sm:py-4">
      {error && <div role="alert" className="rounded border border-destructive p-3 text-sm">{error}</div>}
      {/* Workflow only: where the save stands, what is still missing, and the
          two actions. Derived figures live beside the fields they come from. */}
      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-4"><div className="min-w-0"><p className="hidden font-semibold sm:block">{facility.name} · {dateLabel(week)}</p><p role="status" id="stand-up-save-state" className="text-sm sm:mt-1">{routePending ? 'Opening page — editing paused' : saveText}</p>{/* Provided counts populated figures. It is not a review, so the bar that
            stays on screen says so rather than letting 16/16 read as approved. */}
        <p className="mt-1 text-xs text-muted-foreground">{complete?.completed_fields ?? '—'}/16 provided{complete && complete.completed_fields > 0 && status.state !== 'Submitted' ? ' · not yet reviewed' : ''}</p></div>
        {!review && <div className="flex flex-wrap gap-2"><Button type="submit" form="stand-up-entry" variant="outline" aria-describedby="stand-up-save-state" disabled={routePending || !online || !editable || phase === 'saving' || advancedBusy || conflict || (!dirty && !pending.current)}>{phase === 'failed' ? 'Retry save' : 'Save draft'}</Button><Button ref={reviewButton} aria-describedby="stand-up-save-state" disabled={routePending || !editable || !online || phase === 'saving' || advancedBusy || conflict || !!pending.current} onClick={() => { if (validationMessage) { setError(validationMessage); return; } setReview(true); }}>Review and submit</Button></div>}
      </div>
      {(dirty || conflict) && <Button variant="ghost" disabled={routePending || phase === 'saving' || advancedBusy || !!pending.current} onClick={discard}>{conflict ? 'Discard my edits and load saved figures' : 'Discard unsaved changes'}</Button>}
      {pending.current && phase === 'failed' && <p className="text-xs text-muted-foreground">The save result is uncertain. Retry the same save to recover its receipt before switching or discarding.</p>}
    </section>
    <section className="space-y-3 border-t border-border pt-4"><Button variant="ghost" disabled={routePending || advancedBusy || !!pending.current} aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen(value => !value)}>{props.recoveries.length ? `${props.recoveries.length} spreadsheet ${props.recoveries.length === 1 ? 'change needs' : 'changes need'} review` : 'Spreadsheet recovery and backup'}</Button>{recoveryOpen && <RecoveryTools facility={facility} week={week} report={saved} recoveries={props.recoveries} disabled={routePending || dirty || phase === 'saving' || !!pending.current || !editable} onSaved={acceptRecovery} onBusy={value => { guardState.current.advancedBusy = value; setAdvancedBusy(value); }} onDenied={onDenied} onReload={props.onReload} />}</section>
  </section>;
}
