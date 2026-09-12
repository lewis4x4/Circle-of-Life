'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerRouteLeaveGuard, useRouteTransitionPending, isRouteTransitionPending } from '@/components/layout/navigation-pending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dateLabel, derivedValues, type StandUpValues } from '@/lib/stand-up/model';
import { StandUpRequestError, standUpRequest } from './transport';

type Stage = { batch_id: string; rows: { facility_id?: string; week_start?: string; values?: StandUpValues }[] };
export function HistoricalImports({ onReload, onDenied, bindGuard }: {
  onReload: () => Promise<void>; onDenied: () => void; bindGuard: (guard: (silent?: boolean) => boolean) => () => void;
}) {
  const routePending = useRouteTransitionPending();
  const [text, setText] = useState(''); const [stage, setStage] = useState<Stage | null>(null);
  const [batchId, setBatchId] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const alive = useRef(true); const locked = useRef(false); const ids = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    const guard = (silent?: boolean) => { if (!locked.current) return true; if (!silent) setError('Wait for the import operation to finish before leaving or switching.'); return false; };
    const unbindScope = bindGuard(guard); const unbindRoute = registerRouteLeaveGuard(guard);
    return () => { unbindScope(); unbindRoute(); };
  }, [bindGuard]);
  async function run(operation: () => Promise<void>) {
    if (locked.current || isRouteTransitionPending()) return; locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { if (alive.current) { if (cause instanceof StandUpRequestError && [401, 403].includes(cause.status)) onDenied(); else setError(cause instanceof Error ? cause.message : 'Could not complete the import.'); } }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  }
  return <fieldset disabled={routePending || busy} aria-label="Historical import tools" className="mt-3 space-y-4 rounded border border-border p-4">
    <h2 className="text-lg font-semibold">Historical report management</h2><p className="text-sm text-muted-foreground">Import reviewed historical reports from a prepared Haven import file. Original file references and a correction history are retained. This does not mark reports as administrator-reviewed.</p>
    {error && <p role="alert" className="rounded border border-destructive p-3">{error}</p>}{notice && <p role="status">{notice}</p>}
    <label htmlFor="import-file" className="block text-sm">Prepared historical import file<Input id="import-file" type="file" accept=".json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { if (file.size > 1000000) throw new Error('Split this import into files smaller than 1 MB.'); const content = await file.text(); if (alive.current) { setText(content); setStage(null); } }); }} /></label>
    <details><summary className="cursor-pointer text-sm font-medium">Advanced import details</summary><p className="mt-2 text-xs text-muted-foreground">For prepared migration files only. Preserve facility IDs, versions and original provenance. Currency values in the file are cents and overtime is the preserved HH.MM notation.</p><label htmlFor="import-json" className="mt-2 block text-sm">Import JSON<textarea id="import-json" className="mt-1 min-h-40 w-full rounded border border-border bg-background p-3 font-mono text-xs" value={text} disabled={busy} onChange={event => { setText(event.target.value); setStage(null); }} /></label></details>
    <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void run(async () => { const payload = JSON.parse(text); const fingerprint = JSON.stringify(payload); const requestId = ids.current.get(fingerprint) ?? crypto.randomUUID(); ids.current.set(fingerprint, requestId); const result = await standUpRequest<Stage>('stage_import', { ...payload, request_id: requestId }); if (alive.current) { setStage(result); setBatchId(result.batch_id); } })}>Validate import</Button>
    {stage && <section className="space-y-3 border-t border-border pt-3"><h3 className="font-semibold">Review {stage.rows.length} prepared reports</h3><ul className="text-sm">{stage.rows.map((row, index) => <li key={index}>{row.week_start ? dateLabel(row.week_start) : 'Meeting date in prepared file'} · {row.values ? `${derivedValues(row.values).completed_fields}/16 figures` : 'See prepared import details'}</li>)}</ul><details><summary className="cursor-pointer text-sm">Inspect validated import details</summary><pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(stage.rows, null, 2)}</pre></details><Button disabled={busy} onClick={() => void run(async () => { await standUpRequest('commit_import', { batch_id: stage.batch_id }); if (!alive.current) return; setNotice('Historical reports imported. Original file references are retained.'); setStage(null); setText(''); await onReload(); })}>Import reviewed reports</Button></section>}
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">Reverse an imported batch</summary><div className="mt-3 space-y-3"><p className="text-sm">A reversal preserves the original history and later independent edits. Any conflicts still require review.</p><label htmlFor="import-batch-id" className="block text-sm">Import batch ID<Input id="import-batch-id" value={batchId} disabled={busy} onChange={event => setBatchId(event.target.value)} /></label><label htmlFor="import-reversal-reason" className="block text-sm">Reason for reversal<Input id="import-reversal-reason" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><Button variant="outline" disabled={busy || !batchId.trim() || !reason.trim()} onClick={() => void run(async () => { const result = await standUpRequest<{ restored: unknown[]; conflicts: unknown[] }>('reverse_import', { batch_id: batchId, reason }); if (!alive.current) return; setNotice(`Reversal completed. ${Array.isArray(result.restored) ? result.restored.length : String(result.restored)} restored; ${Array.isArray(result.conflicts) ? result.conflicts.length : String(result.conflicts)} require review.`); await onReload(); })}>Reverse import and retain history</Button></div></details>
  </fieldset>;
}
