'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { noticeDueLine, parseNotices, reconcileHref, type CensusNotice } from '@/lib/stand-up/census-disagreement';
import { MEETING_LABELS } from '@/lib/stand-up/meetings';

/**
 * COL-751: the census notices sent to the signed-in person before a Stand Up
 * deadline, while the disagreement is still open. Each clears itself the moment
 * either side is fixed; nothing here is dismissed by hand.
 */
export function CensusNotices({ refreshKey }: { refreshKey?: unknown }) {
  const [notices, setNotices] = useState<CensusNotice[]>([]);
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
  }, [refreshKey]);
  if (!notices.length) return null;
  return <section aria-label="Census notices" className="space-y-2">
    {notices.map(notice => <div key={notice.id} role="alert" className="flex flex-wrap items-start gap-3 rounded border border-warning bg-warning/5 p-3 text-sm">
      <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{notice.unreconciled ? 'Census unreconciled at the call' : 'Census disagrees with the roster'} · {notice.facility_name}, {MEETING_LABELS[notice.meeting_day]} Stand Up</p>
        <p>{notice.figures.length ? notice.figures.map(figure => `${figure.label}: Stand Up says ${figure.stand_up ?? 'blank'}, roster says ${figure.roster ?? 'none'}`).join('. ') : notice.message}</p>
        <p className="text-xs text-muted-foreground">{noticeDueLine(notice)}</p>
      </div>
      <Link href={reconcileHref(notice)} className="font-medium underline underline-offset-2">Reconcile</Link>
    </div>)}
  </section>;
}
