'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { STAND_UP_ENTRY_OPEN_CHOICES, STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES, entryOpenLeadMinutes } from '@/lib/stand-up/model';
import { standUpRequest } from './transport';
import type { StandUpEntryWindowSaved, StandUpFacility } from './types';

/**
 * When each ALF's Weekly Stand Up opens. Owner and organization administrator
 * only: an administrator enters figures, they do not move their own deadline.
 * The 8:45 a.m. target and the 9:15 a.m. call are not settings and are not here.
 */
export function EntryWindowSettings({ facilities, disabled, onSaved, onDenied }: {
  facilities: StandUpFacility[]; disabled: boolean;
  onSaved: () => Promise<void>; onDenied: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ facility: string; text: string; failed: boolean } | null>(null);
  const apply = async (facility: StandUpFacility, value: string) => {
    if (busy) return;
    setBusy(facility.id); setMessage(null);
    try {
      const saved = await standUpRequest<StandUpEntryWindowSaved>('set_entry_window', { facility_id: facility.id, entry_open_lead_minutes: value ? Number(value) : null });
      const label = STAND_UP_ENTRY_OPEN_CHOICES.find(choice => choice.minutes === entryOpenLeadMinutes(saved.entry_open_lead_minutes))?.label;
      setMessage({ facility: facility.id, text: `${facility.name} entry opens ${label} Eastern.`, failed: false });
      await onSaved();
    } catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? Number((cause as { status: unknown }).status) : 0;
      if (status === 401 || status === 403) { onDenied(); return; }
      setMessage({ facility: facility.id, text: cause instanceof Error ? cause.message : 'The entry window was not changed.', failed: true });
    } finally { setBusy(''); }
  };
  return <section aria-label="Entry window" className="space-y-3 border-t border-border pt-4">
    <h3 className="font-medium">Entry window</h3>
    <p className="text-sm text-muted-foreground">When each ALF can start its Monday report. The 8:45 a.m. target and the 9:15 a.m. call do not change.</p>
    {facilities.map(facility => {
      const current = facility.entry_open_lead_minutes ?? '';
      const note = message?.facility === facility.id ? message : null;
      const noteId = `entry-window-note-${facility.id}`;
      return <div key={facility.id} className="flex flex-wrap items-end gap-3">
        <label htmlFor={`entry-window-${facility.id}`} className="block text-xs font-medium">Entry opens · {facility.name}
          <select id={`entry-window-${facility.id}`} defaultValue={String(current)} disabled={disabled || busy === facility.id}
            aria-invalid={note?.failed || undefined} aria-describedby={note ? noteId : undefined}
            onChange={event => void apply(facility, event.target.value)}
            className="mt-1 block min-h-10 w-full rounded border border-border bg-background px-3 text-sm sm:w-64">
            <option value="">Haven default · {STAND_UP_ENTRY_OPEN_CHOICES.find(choice => choice.minutes === STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES)?.label}</option>
            {STAND_UP_ENTRY_OPEN_CHOICES.map(choice => <option key={choice.minutes} value={choice.minutes}>{choice.label}</option>)}
          </select>
        </label>
        {busy === facility.id && <p role="status" className="text-sm text-muted-foreground">Saving…</p>}
        {note && <p id={noteId} role={note.failed ? 'alert' : 'status'} className={`text-sm ${note.failed ? 'text-destructive' : 'text-muted-foreground'}`}>{note.text}</p>}
      </div>;
    })}
    <Button variant="ghost" disabled={disabled || !!busy} onClick={() => void onSaved()}>Refresh entry windows</Button>
  </section>;
}
