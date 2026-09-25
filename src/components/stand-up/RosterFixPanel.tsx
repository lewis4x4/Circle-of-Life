'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdmissionArrivalPanel } from '@/components/admissions/AdmissionArrivalPanel';
import { RecordDischargeAction } from '@/components/residents/RecordDischargeAction';
import { ResidentPresenceControl } from '@/components/residents/ResidentPresenceControl';
import { mapResidencyStatus, type BedHoldStayType } from '@/lib/residents/presence';
import { createClient } from '@/lib/supabase/client';

type RosterRow = { id: string; name: string; status: string; stayType: BedHoldStayType | null };
type ArrivalRow = { caseId: string; residentId: string | null; name: string; target: string | null };

const personName = (row: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null }) =>
  [row.preferred_name?.trim() || row.first_name?.trim(), row.last_name?.trim()].filter(Boolean).join(' ') || 'Name not recorded';

/**
 * COL-555: fix the roster from inside the Reconcile dialog, without leaving the
 * report. Each change goes through the roster's own write path (the presence
 * control for hospital, rehab, leave and return; the official discharge; the
 * admission's approval and arrival, COL-333), and every change calls
 * `onRosterChanged` so the dialog reads the disagreement again. A resident who
 * is not in Haven at all needs a full admission, which the last line links to.
 */
export function RosterFixPanel({ facilityId, facilityName, onRosterChanged }: {
  facilityId: string
  facilityName: string
  onRosterChanged: () => void
}) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [arrivals, setArrivals] = useState<ArrivalRow[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const changed = useCallback(() => { setTick(value => value + 1); onRosterChanged(); }, [onRosterChanged]);

  useEffect(() => {
    let live = true;
    const supabase = createClient();
    void Promise.all([
      supabase.from('residents').select('id, first_name, last_name, preferred_name, status, bed_hold_stay_type')
        .eq('facility_id', facilityId).in('status', ['active', 'hospital_hold', 'loa']).is('deleted_at', null)
        .order('last_name', { ascending: true }).limit(300),
      supabase.from('admission_cases').select('id, resident_id, target_move_in_date, status, residents(first_name, last_name, preferred_name)')
        .eq('facility_id', facilityId).in('status', ['pending_clearance', 'bed_reserved']).is('deleted_at', null)
        .order('target_move_in_date', { ascending: true, nullsFirst: false }).limit(50),
    ]).then(([residents, cases]) => {
      if (!live) return;
      if (residents.error || cases.error) { setError('The roster could not be read. Open the resident roster instead.'); return; }
      setError('');
      setRoster(((residents.data ?? []) as unknown as Array<Record<string, unknown>>).map(row => ({
        id: String(row.id), name: personName(row as Parameters<typeof personName>[0]), status: String(row.status),
        stayType: (row.bed_hold_stay_type as BedHoldStayType | null) ?? null,
      })));
      setArrivals(((cases.data ?? []) as unknown as Array<Record<string, unknown>>).map(row => ({
        caseId: String(row.id), residentId: typeof row.resident_id === 'string' ? row.resident_id : null,
        name: personName((row.residents ?? {}) as Parameters<typeof personName>[0]),
        target: typeof row.target_move_in_date === 'string' ? row.target_move_in_date : null,
      })));
    });
    return () => { live = false; };
  }, [facilityId, tick]);

  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!roster || !arrivals) return <p role="status" className="text-sm text-muted-foreground">Reading the {facilityName} roster…</p>;
  return <div className="space-y-3">
    <details className="rounded border border-border p-2">
      <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Arrivals waiting to be confirmed ({arrivals.length})</summary>
      {arrivals.length === 0
        ? <p className="mt-2 text-sm text-muted-foreground">No admission at {facilityName} is waiting for its arrival.</p>
        : <ul className="mt-2 space-y-3">{arrivals.map(row => <li key={row.caseId} className="space-y-1 border-t border-border pt-2">
            <p className="text-sm font-medium">{row.name}{row.target ? <span className="font-normal text-muted-foreground"> · target move-in {row.target}</span> : null}</p>
            <AdmissionArrivalPanel caseId={row.caseId} facilityId={facilityId} residentId={row.residentId} onChanged={changed} />
          </li>)}</ul>}
    </details>
    <details className="rounded border border-border p-2">
      <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Residents on the roster ({roster.length})</summary>
      <p className="mt-2 text-xs text-muted-foreground">Record a hospital stay, rehab, leave or return here, or record a discharge. Each change is dated when it happened.</p>
      <ul className="mt-2 divide-y divide-border">{roster.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span className="font-medium">{row.name}</span>
        <span className="flex flex-wrap items-center gap-2">
          <ResidentPresenceControl residentId={row.id} status={mapResidencyStatus(row.status)} stayType={row.stayType} onChanged={changed} />
          <RecordDischargeAction residentId={row.id} residentName={row.name} onDone={changed} />
        </span>
      </li>)}</ul>
    </details>
    <p className="text-sm">Someone arrived who is not in Haven yet? <Link href="/admin/admissions/new" className="font-medium underline underline-offset-2">Start their admission</Link>. Their arrival is confirmed on the admission, then this clears.</p>
  </div>;
}
