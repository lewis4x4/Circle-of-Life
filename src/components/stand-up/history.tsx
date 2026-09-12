'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { METRICS, derivedValues, dollars, easternTime, fieldDisplay, metricDisplay, reportState, FIELD_STATE_TEXT, type MetricKey, type StandUpReport } from '@/lib/stand-up/model';
import { StandUpRequestError, standUpRequest } from './transport';

function difference(current: number | null, prior: number | null | undefined, currency = false) {
  if (current === null || prior === null || prior === undefined) return 'Change unavailable';
  const delta = current - prior;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${currency ? dollars(Math.abs(delta)) : Math.abs(delta)}`;
}
type Revision = { version: number; revision_id: string; status: 'draft' | 'ready'; created_at: string; reason: string | null; values: StandUpReport['values']; updated_by: string | null; updated_by_name: string | null; entry_origin?: StandUpReport['entry_origin'] };
type RevisionHistory = { facility_id: string; week_start: string; revisions: Revision[] };

/** Per-field changes between consecutive revisions, read from Haven's own immutable revisions. */
export function revisionChanges(revisions: Revision[]): { version: number; when: string; who: string; reason: string | null; origin: string; changes: string[] }[] {
  return revisions.map((revision, index) => {
    const previous = revisions[index - 1];
    const changes = previous ? METRICS.filter(metric => revision.values[metric.key] !== previous.values[metric.key]).map(metric => `${metric.label}: ${metricDisplay(metric.key, previous.values[metric.key])} to ${metricDisplay(metric.key, revision.values[metric.key])}`) : [];
    const origin = revision.entry_origin === 'imported' ? 'Imported from the workbook' : revision.entry_origin === 'recovery' ? 'Spreadsheet recovery' : revision.entry_origin === 'initialized' ? 'Empty baseline' : revision.status === 'ready' ? 'Submitted' : 'Draft saved';
    return { version: revision.version, when: easternTime(revision.created_at), who: revision.updated_by_name ?? 'Unknown', reason: revision.reason, origin, changes };
  });
}

function WhatChanged({ report, facilityName }: { report: StandUpReport; facilityName: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<RevisionHistory | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (history || busy) return;
    setBusy(true); setError('');
    try {
      const result = await standUpRequest<RevisionHistory>('revisions', { facility_id: report.facility_id, week_start: report.week_start });
      if (result.facility_id !== report.facility_id || result.week_start !== report.week_start) throw new Error('The revision list did not match this facility and meeting.');
      setHistory(result);
    } catch (cause) {
      setError(cause instanceof StandUpRequestError && [401, 403].includes(cause.status) ? 'Your access changed. Refresh reports.' : cause instanceof Error ? cause.message : 'Revisions could not be loaded.');
    } finally { setBusy(false); }
  };
  const entries = history ? revisionChanges(history.revisions) : [];
  return <div>
    <Button variant="ghost" size="sm" aria-expanded={open} disabled={busy} onClick={() => void load()}>{open ? 'Hide changes' : `What changed · ${report.version === 1 ? '1 revision' : `${report.version} revisions`}`}</Button>
    {open && <div className="mt-2 space-y-2 text-xs" aria-label={`${facilityName} ${report.week_start} revision changes`}>
      {busy && <p role="status">Loading revisions…</p>}
      {error && <p role="alert">{error}</p>}
      {entries.map(entry => <div key={entry.version} className="border-l-2 border-border pl-2">
        <p className="font-medium">Revision {entry.version} · {entry.when} Eastern · {entry.who} · {entry.origin}{entry.reason ? ` · ${entry.reason}` : ''}</p>
        {entry.version > 1 && (entry.changes.length ? <ul className="list-disc pl-4">{entry.changes.map(change => <li key={change}>{change}</li>)}</ul> : <p>No figure changed.</p>)}
      </div>)}
    </div>}
  </div>;
}

export function StandUpHistory({ reports, facilityId, facilityName }: {
  reports: StandUpReport[]; facilityId: string; facilityName: string;
}) {
  const rows = reports.filter(report => report.facility_id === facilityId)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
  const cell = (report: StandUpReport, key: MetricKey) => fieldDisplay(report, key);
  return <section aria-label="Facility report history" className="space-y-3 rounded border p-4">
    <h2 className="text-lg font-semibold">{facilityName} — report history</h2>
    <p>Newest week first. Changes compare with the previous available report. Gaps are identified; missing figures are not zero. These are reported figures; payroll and operating-record verification is separate.</p>
    {rows.length === 0 ? <p>No saved reports for this facility yet.</p> : <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable facility history table">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Weekly facility figures and changes from the previous available report</caption>
        <thead><tr>{['Monday / comparison', 'Monthly rent roll / change', 'Census / change', 'Calculated average rent', 'Prior-week callouts', 'Prior-week overtime', 'Status', 'Figures observed (Eastern)', 'Revisions'].map(label => <th className="p-2 align-top" scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((report, index) => {
          const prior = rows[index + 1];
          const days = prior ? (Date.parse(`${report.week_start}T12:00:00Z`) - Date.parse(`${prior.week_start}T12:00:00Z`)) / 86400000 : null;
          const derived = derivedValues(report.values);
          return <tr key={report.id} className="border-t">
            <th scope="row" className="p-2 align-top font-normal">{report.week_start}<span className="block text-xs">{prior ? `Compared with ${prior.week_start}${days !== 7 ? ' — gap in weekly reports' : ''}` : 'No earlier report'}</span></th>
            <td className="p-2 align-top tabular-nums">{cell(report, 'monthly_rent_roll_cents')}<span className="block text-xs">{difference(report.values.monthly_rent_roll_cents, prior?.values.monthly_rent_roll_cents, true)}</span></td>
            <td className="p-2 align-top tabular-nums">{cell(report, 'current_total_census')}<span className="block text-xs">{difference(report.values.current_total_census, prior?.values.current_total_census)}</span></td>
            <td className="p-2 align-top tabular-nums">{derived.average_rent_cents === null ? 'Not calculable' : dollars(derived.average_rent_cents)}</td>
            <td className="p-2 align-top tabular-nums">{cell(report, 'callouts_last_week')}</td>
            <td className="p-2 align-top tabular-nums">{cell(report, 'overtime_reported')}</td>
            <td className="p-2 align-top">{reportState(report)}</td>
            <td className="p-2 align-top">{report.source_as_of ? new Date(report.source_as_of).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Unknown'}</td>
            <td className="p-2 align-top"><WhatChanged report={report} facilityName={facilityName} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="text-xs text-muted-foreground">{FIELD_STATE_TEXT.held_unit_unconfirmed}: the imported overtime notation is kept as evidence until its unit is confirmed. {FIELD_STATE_TEXT.not_provided}: an administrator left the figure blank.</p>
  </section>;
}
