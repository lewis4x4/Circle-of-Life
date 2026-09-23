'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchOutOfHouse, sinceLabel, type OutOfHouseRow } from '@/lib/residents/out-of-house';
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

/**
 * Tier 2 disclosure under the census group: who is out of house right now.
 * Names, rooms and ids are read through resident RLS for the selected facility
 * only and never enter the Stand Up payload. Collapsed by default.
 */
export function OutOfHousePanel({ facilityId, facilityName, refreshKey = 0 }: { facilityId: string; facilityName: string; refreshKey?: number }) {
  const [rows, setRows] = useState<OutOfHouseRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetchOutOfHouse(facilityId).then(result => { if (live) { setRows(result); setError(''); } }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'The roster could not be read.'); });
    return () => { live = false; };
  }, [facilityId, refreshKey]);
  return <details className="text-sm">
    <summary className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Out of house{rows ? ` (${rows.length})` : ''}</summary>
    <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
      <p className="text-xs text-muted-foreground">Residents at the hospital or on leave whose bed is held, as the {facilityName} roster shows them. Shown only here; nothing on this list travels with the report.</p>
      {error ? <p role="alert" className="text-sm">Out of house list unavailable: {error}</p>
        : rows === null ? <p role="status" className="text-xs text-muted-foreground">Reading the roster…</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">No residents are out of house.</p>
        : <HorizontalScroll label="Residents out of house"><table className="w-full text-left text-sm"><caption className="sr-only">Residents out of house, hospital first</caption>
          <thead><tr>{['Resident', 'Room', 'Status', 'Since', ''].map((label, index) => <th key={index} scope="col" className="py-1 pr-3 text-xs font-medium text-muted-foreground">{label || <span className="sr-only">Record</span>}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-t border-border">
            <th scope="row" className="py-1.5 pr-3 font-medium">{row.name}</th>
            <td className="py-1.5 pr-3 tabular-nums">{row.room}</td>
            <td className="py-1.5 pr-3">{row.label}</td>
            <td className="py-1.5 pr-3 tabular-nums">{sinceLabel(row.since)}</td>
            <td className="py-1.5"><Link href={`/admin/residents/${row.id}`} className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Open record<span className="sr-only"> for {row.name}</span></Link></td>
          </tr>)}</tbody></table></HorizontalScroll>}
    </div>
  </details>;
}
