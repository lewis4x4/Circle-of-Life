'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouteTransitionPending, isRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { METRICS, metricDisplay, validateValues, STAND_UP_WORKBOOK_URL, STAND_UP_WORKBOOK_LINK_TEXT, STAND_UP_OUTAGE_BACKUP_TEXT, type MetricKey, type StandUpReport, type StandUpValues } from '@/lib/stand-up/model';
import { overtimePartsToLegacy } from '@/lib/stand-up/duration';
import { StandUpRequestError, standUpRequest, downloadText, fallbackCsv, parseFallback, type FallbackFile } from './transport';
import type { RecoveryPreview } from './types';

type Choice = { kind: '' | 'haven' | 'file' | 'corrected' | 'clear'; value: string; hours: string; minutes: string };
const emptyChoice = (): Choice => ({ kind: '', value: '', hours: '', minutes: '' });
export function RecoveryTools({ facility, week, report, recoveries, disabled, onSaved, onBusy, onDenied, onReload }: {
  facility: { id: string; name: string }; week: string; report?: StandUpReport; recoveries: RecoveryPreview[];
  disabled: boolean; onSaved: (report: StandUpReport) => void; onBusy: (busy: boolean) => void; onDenied: () => void; onReload: () => Promise<void>;
}) {
  const routePending = useRouteTransitionPending();
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [choices, setChoices] = useState<Partial<Record<MetricKey, Choice>>>({});
  const [confirmClears, setConfirmClears] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const alive = useRef(true); const locked = useRef(false); const requests = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const matches = (value: { facility_id: string; week_start: string }) => value.facility_id === facility.id && value.week_start === week;
  async function run(operation: () => Promise<void>) {
    if (locked.current || disabled || isRouteTransitionPending()) return;
    locked.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) onDenied();
      else setError(cause instanceof Error ? cause.message : 'Could not complete the review. Try again.');
    } finally { if (alive.current) { locked.current = false; setBusy(false); onBusy(false); } }
  }
  function open(value: RecoveryPreview) {
    if (!matches(value)) throw new Error('This spreadsheet change belongs to a different facility or meeting. No changes were applied.');
    setPreview(value); setChoices({}); setConfirmClears(false);
  }
  const disputed = preview ? [...new Set([...preview.conflicts, ...preview.clears])] : [];
  function resolved(key: MetricKey): number | null {
    const choice = choices[key] ?? emptyChoice();
    if (!preview || !choice.kind) throw new Error(`Choose how to resolve ${METRICS.find(metric => metric.key === key)?.label}.`);
    if (choice.kind === 'haven') return preview.current?.[key] ?? null;
    if (choice.kind === 'file') return preview.incoming?.[key] ?? null;
    if (choice.kind === 'clear') return null;
    if (key === 'overtime_reported') return overtimePartsToLegacy(choice.hours, choice.minutes);
    if (!choice.value.trim()) throw new Error('Enter the corrected figure, or choose Leave blank.');
    if (key === 'monthly_rent_roll_cents' && !/^\d+(\.\d{1,2})?$/.test(choice.value.trim())) throw new Error('Enter dollars with up to two decimal places.');
    return key === 'monthly_rent_roll_cents' ? Math.round(Number(choice.value) * 100) : Number(choice.value);
  }
  let containsClear = false;
  try { containsClear = disputed.some(key => !!choices[key]?.kind && resolved(key) === null); } catch { /* Inline inputs may still be incomplete. */ }
  return <fieldset disabled={busy || disabled || routePending} className="space-y-4 rounded border border-border p-4">
    <h3 className="font-semibold">Spreadsheet changes · {facility.name}</h3><p className="text-sm text-muted-foreground">During a Haven outage, use the shared Stand Up workbook while Drive is available: <a className="font-medium text-foreground underline underline-offset-2" href={STAND_UP_WORKBOOK_URL} target="_blank" rel="noopener noreferrer">{STAND_UP_WORKBOOK_LINK_TEXT}</a>. {STAND_UP_OUTAGE_BACKUP_TEXT} Changes needing a decision appear here. Review them before replacing any saved figures.</p>
    {error && <p role="alert" className="rounded border border-destructive p-3 text-sm">{error}</p>}{notice && <p role="status">{notice}</p>}
    {recoveries.filter(value => !completed.includes(value.preview_id)).map((value, index) => <div key={value.preview_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="text-sm">Spreadsheet change {index + 1} · {value.conflicts.length} different figures · {value.clears.length} proposed blanks</span><Button variant="outline" disabled={busy || disabled} onClick={() => open(value)}>Review spreadsheet change {index + 1}</Button></div>)}
    {preview && <section aria-label="Review spreadsheet changes" className="space-y-4">
      <h4 className="font-semibold">Choose the correct figures</h4><p className="text-sm">Every replacement below will be saved for {facility.name}, meeting {week}.</p>
      <div className="space-y-3">{METRICS.map(metric => {
        const disputedField = disputed.includes(metric.key); const choice = choices[metric.key] ?? emptyChoice();
        const change = (patch: Partial<Choice>) => setChoices(current => ({ ...current, [metric.key]: { ...(current[metric.key] ?? emptyChoice()), ...patch } }));
        return <div key={metric.key} className="space-y-2 border-t border-border pt-3 text-sm"><p className="font-medium">{metric.label}</p>{!disputedField ? <p>{metricDisplay(metric.key, preview.merged[metric.key])}</p> : <>
          <p className="text-xs text-muted-foreground">Previously: {metricDisplay(metric.key, preview.baseline?.[metric.key] ?? null)} · Haven: {metricDisplay(metric.key, preview.current?.[metric.key] ?? null)} · Spreadsheet: {metricDisplay(metric.key, preview.incoming?.[metric.key] ?? null)}</p>
          <label className="block">Decision for {metric.label}<select aria-label={`Decision for ${metric.label}`} disabled={busy || disabled} value={choice.kind} className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3" onChange={event => change({ kind: event.target.value as Choice['kind'] })}><option value="">Choose a value</option><option value="haven">Keep Haven value · {metricDisplay(metric.key, preview.current?.[metric.key] ?? null)}</option><option value="file">Use spreadsheet value · {metricDisplay(metric.key, preview.incoming?.[metric.key] ?? null)}</option><option value="corrected">Enter corrected value</option><option value="clear">Leave blank</option></select></label>
          {choice.kind === 'corrected' && (metric.key === 'overtime_reported' ? <div className="grid grid-cols-2 gap-3"><label>Corrected overtime hours<Input type="number" min="0" step="1" value={choice.hours} onChange={event => change({ hours: event.target.value })} /></label><label>Corrected overtime minutes<Input type="number" min="0" max="59" step="1" value={choice.minutes} onChange={event => change({ minutes: event.target.value })} /></label></div> : <label className="block">Corrected {metric.label}{metric.key === 'monthly_rent_roll_cents' ? ' ($)' : ''}<Input type="number" min="0" step={metric.key === 'monthly_rent_roll_cents' ? '0.01' : '1'} value={choice.value} onChange={event => change({ value: event.target.value })} /></label>)}
        </>}</div>;
      })}</div>
      {containsClear && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmClears} onChange={event => setConfirmClears(event.target.checked)} /> I intend to leave the selected figures blank.</label>}
      <Button disabled={busy || disabled || disputed.some(key => !choices[key]?.kind) || (containsClear && !confirmClears)} onClick={() => void run(async () => {
        if (!matches(preview)) throw new Error('The review no longer matches this facility and meeting.');
        const resolutions = Object.fromEntries(disputed.map(key => [key, resolved(key)]));
        const merged = { ...preview.merged, ...resolutions } as StandUpValues;
        const issues = validateValues(merged); if (issues.length) throw new Error(issues.join(' '));
        const payload = { facility_id: facility.id, week_start: week, preview_id: preview.preview_id, expected_version: preview.expected_version, resolutions, confirm_clears: confirmClears };
        const fingerprint = JSON.stringify(payload); const requestId = requests.current.get(fingerprint) ?? crypto.randomUUID(); requests.current.set(fingerprint, requestId);
        const result = await standUpRequest<StandUpReport>('commit_recovery', { ...payload, request_id: requestId });
        if (!alive.current) return;
        if (!matches(result)) throw new Error('The save receipt did not match this review. Refresh reports before continuing.');
        onSaved(result); setCompleted(current => [...current, preview.preview_id]); setPreview(null); setNotice('Reviewed spreadsheet changes saved.');
        await onReload();
      })}>Save reviewed choices for {facility.name}</Button>
    </section>}
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">Manual backup and recovery</summary><div className="mt-3 space-y-3"><p className="text-sm">Use an exported Haven backup when directed by management. Save your report before downloading; upload edited files to review their changes.</p><div className="flex flex-wrap gap-2">{(['json', 'csv'] as const).map(format => <Button key={format} variant="outline" disabled={busy || disabled || !report} onClick={() => void run(async () => { const result = await standUpRequest<FallbackFile>('export', { facility_id: facility.id, week_start: week }); if (!alive.current) return; if (!matches(result)) throw new Error('The backup belongs to another facility or meeting.'); downloadText(`stand-up-${facility.name}-${week}.${format}`, format === 'json' ? JSON.stringify(result, null, 2) : fallbackCsv(result), format === 'json' ? 'application/json' : 'text/csv'); })}>Download {format.toUpperCase()} backup</Button>)}</div><label htmlFor="haven-backup-upload" className="block text-sm">Upload edited Haven backup<Input id="haven-backup-upload" type="file" accept=".json,.csv" disabled={busy || disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { if (file.size > 1000000) throw new Error('The backup exceeds 1 MB.'); const data = parseFallback(await file.text()); if (!alive.current) return; if (!matches(data)) throw new Error('Select the facility and meeting that match this backup first.'); const result = await standUpRequest<RecoveryPreview>('preview_recovery', { baseline_id: data.baseline_id, facility_id: facility.id, week_start: week, values: data.values }); if (alive.current) open(result); }); }} /></label></div></details>
  </fieldset>;
}
