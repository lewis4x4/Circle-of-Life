'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { chipText, parseDisagreements, reconcileHref, showsChip, type CensusDisagreement } from '@/lib/stand-up/census-disagreement';
import type { MeetingDay } from '@/lib/stand-up/meetings';

/**
 * COL-555: the one census-disagreement chip. Every surface that shows census
 * (Stand Up, the resident roster, the executive drill-down, Data Health) renders
 * this, so the same fact reads the same everywhere. It shows nothing when the
 * figures agree, when nothing has been entered, or when the reader may not see
 * Stand Up; it never claims agreement it could not check.
 */
export async function loadCensusDisagreements(facilityId: string | null): Promise<CensusDisagreement[] | null> {
  try {
    const client = createClient();
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
    const { data, error } = await rpc('stand_up_census_disagreements', { p_facility: facilityId });
    if (error) return null;
    return parseDisagreements(data);
  } catch {
    return null;
  }
}

export function CensusDisagreementChips({ facilityId, meetingDay, refreshKey, action, className }: {
  facilityId: string | null
  /** Only this meeting; all scheduled meetings when omitted. */
  meetingDay?: MeetingDay
  /** Change to read the disagreement again (after a save or a roster change). */
  refreshKey?: unknown
  /** Replaces the Reconcile link, e.g. with the dialog on the Stand Up page itself. */
  action?: (d: CensusDisagreement) => ReactNode
  className?: string
}) {
  const [rows, setRows] = useState<CensusDisagreement[]>([]);
  const load = useCallback(async () => {
    const data = await loadCensusDisagreements(facilityId);
    setRows(data ?? []);
  }, [facilityId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const shown = rows.filter(row => showsChip(row) && (!meetingDay || row.meeting_day === meetingDay) && (!facilityId || row.facility_id === facilityId));
  if (!shown.length) return null;
  return <div className={className ?? 'space-y-2'}>
    {shown.map(row => <CensusDisagreementChip key={`${row.facility_id}:${row.meeting_day}`} disagreement={row} action={action} showFacility={!facilityId} />)}
  </div>;
}

export function CensusDisagreementChip({ disagreement, action, showFacility = false }: { disagreement: CensusDisagreement; action?: (d: CensusDisagreement) => ReactNode; showFacility?: boolean }) {
  const text = chipText(disagreement);
  const open = disagreement.state === 'open';
  return <div role="status" aria-label={`${showFacility ? `${disagreement.facility_name}: ` : ''}${text}`}
    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2 text-sm ${open ? 'border-warning bg-warning/5' : 'border-border bg-muted/30'}`}>
    <TriangleAlert className="size-4 shrink-0" aria-hidden />
    <span className="min-w-0 flex-1">{showFacility && <span className="font-medium">{disagreement.facility_name} · </span>}{text}</span>
    {action ? action(disagreement) : <Link href={reconcileHref(disagreement)} className="font-medium underline underline-offset-2">Reconcile</Link>}
  </div>;
}
