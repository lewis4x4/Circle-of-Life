'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { noticeDueLine, parseNotices, reconcileHref, type CensusDisagreement, type CensusNotice } from '@/lib/stand-up/census-disagreement';
import { MEETING_LABELS } from '@/lib/stand-up/meetings';
import { loadCensusDisagreements } from './CensusDisagreementChip';

// The in-place dialog (with the roster's own write flows) loads only when opened,
// so Home's first load does not carry it.
const ReconcileDialog = dynamic(() => import('./ReconcileDialog').then(module => module.ReconcileDialog), { ssr: false });

/**
 * COL-751: the census notices sent to the signed-in person before a Stand Up
 * deadline, while the disagreement is still open. Each clears itself the moment
 * either side is fixed; nothing here is dismissed by hand.
 *
 * The notice goes to the Administrator, the Assistant Administrator and the
 * Manager (stand_up.census_notice_roles, migration 541). Someone who changes
 * the report follows Reconcile to the report; anyone else reconciles here, by
 * fixing the roster in place, since the report is not theirs to change.
 */
export function CensusNotices({ refreshKey, reconcileHere }: {
  refreshKey?: unknown
  /** Reconcile in place (fix the roster) rather than link to the report; see reconcilesInPlace. */
  reconcileHere?: boolean
}) {
  const here = reconcileHere === true;
  const [notices, setNotices] = useState<CensusNotice[]>([]);
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState<CensusDisagreement | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    try {
      const client = createClient();
      const rpc = client.rpc.bind(client) as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      rpc('stand_up_census_notices_for_me').then(({ data, error }) => {
        if (live) setNotices(error ? [] : parseNotices(data) ?? []);
      }, () => { if (live) setNotices([]); });
    } catch {
      // No client, no notices to show; the page never claims there are none to send.
    }
    return () => { live = false; };
  }, [refreshKey, tick]);
  const openHere = async (notice: CensusNotice) => {
    setProblem('');
    const rows = await loadCensusDisagreements(notice.facility_id);
    const row = rows?.find(item => item.facility_id === notice.facility_id && item.meeting_day === notice.meeting_day);
    if (row) setTarget(row);
    else setProblem('The census disagreement could not be read. Try again.');
  };
  if (!notices.length) return null;
  return <section aria-label="Census notices" className="space-y-2">
    {notices.map(notice => <div key={notice.id} role="alert" className="flex flex-wrap items-start gap-3 rounded border border-warning bg-warning/5 p-3 text-sm">
      <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{notice.unreconciled ? 'Census unreconciled at the call' : 'Census disagrees with the roster'} · {notice.facility_name}, {MEETING_LABELS[notice.meeting_day]} Stand Up</p>
        <p>{notice.figures.length ? notice.figures.map(figure => figure.against === 'monday'
          ? `${figure.label}: Stand Up says ${figure.stand_up ?? 'blank'}, the census bridge from Monday expects ${figure.roster ?? 'none'}`
          : `${figure.label}: Stand Up says ${figure.stand_up ?? 'blank'}, roster says ${figure.roster ?? 'none'}`).join('. ') : notice.message}</p>
        <p className="text-xs text-muted-foreground">{noticeDueLine(notice)}</p>
      </div>
      {here
        ? <Button variant="outline" size="sm" onClick={() => void openHere(notice)}>Reconcile<span className="sr-only"> {notice.facility_name} census</span></Button>
        : <Link href={reconcileHref(notice)} className="font-medium underline underline-offset-2">Reconcile</Link>}
    </div>)}
    {problem && <p role="alert" className="text-sm">{problem}</p>}
    {target && <ReconcileDialog disagreement={target} open onOpenChange={next => { if (!next) { setTarget(null); setTick(value => value + 1); } }}
      canChange={false} onUseRoster={() => {}} onCheckAgain={() => setTick(value => value + 1)}
      explainUnavailable="Only the facility administrator changes the report or records a reason. Fix the roster here, and this clears." />}
  </section>;
}
