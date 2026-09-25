'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chipText, type CensusDisagreement, type DisagreementFigure } from '@/lib/stand-up/census-disagreement';
import { OVERRIDE_REASONS, isOverrideReason, type OverrideReason } from '@/lib/stand-up/roster-census';

/**
 * COL-555: fix a census disagreement from where it is seen, in either direction.
 * Three exits, each leaving Haven consistent, none needing SQL:
 *   1. The roster is right: put the roster's figure on the report.
 *   2. The report is right: fix the roster now (the roster's own admission,
 *      discharge and presence flows), then check again. The report is untouched
 *      and the disagreement clears itself when the roster catches up.
 *   3. Neither is known yet: record why (Monday only). The reason holds for the
 *      facility's reason window, and only while the roster does not change.
 */
export function ReconcileDialog({ disagreement, open, onOpenChange, onUseRoster, onExplain, onCheckAgain, canChange, explainUnavailable }: {
  disagreement: CensusDisagreement
  open: boolean
  onOpenChange: (open: boolean) => void
  onUseRoster: (figure: DisagreementFigure) => void
  /** Absent where the meeting records no reasons (Thursday). */
  onExplain?: (figure: DisagreementFigure, reason: OverrideReason) => void
  onCheckAgain: () => void
  /** False when the report cannot be changed right now (read-only, submitted, not open). */
  canChange: boolean
  explainUnavailable?: string
}) {
  const differing = disagreement.figures.filter(figure => figure.state === 'open' || figure.state === 'explained');
  const [reasons, setReasons] = useState<Partial<Record<DisagreementFigure['key'], OverrideReason>>>({});
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Reconcile census · {disagreement.facility_name}</DialogTitle>
        <DialogDescription>{chipText(disagreement)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-5 text-sm">
        <section aria-labelledby="reconcile-roster-right" className="space-y-2">
          <h3 id="reconcile-roster-right" className="font-medium">The roster is right</h3>
          <p className="text-muted-foreground">Put the roster’s figure on this report.</p>
          <div className="flex flex-wrap gap-2">{differing.map(figure => <Button key={figure.key} variant="outline" disabled={!canChange || figure.roster === null}
            onClick={() => { onUseRoster(figure); onOpenChange(false); }}>Use the roster for {figure.label.toLowerCase()}: {figure.roster ?? 'none'}</Button>)}</div>
        </section>
        <section aria-labelledby="reconcile-report-right" className="space-y-2">
          <h3 id="reconcile-report-right" className="font-medium">The report is right: fix the roster now</h3>
          <p className="text-muted-foreground">Record the admission, discharge, hospital stay or return that is missing, then check again. The report stays as it is, and this clears when the roster matches.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/residents" target="_blank" className="font-medium underline underline-offset-2">Open the resident roster</Link>
            <Link href="/admin/admissions/new" target="_blank" className="font-medium underline underline-offset-2">Record an admission</Link>
            <Button variant="ghost" size="sm" onClick={onCheckAgain}>Check again</Button>
          </div>
        </section>
        <section aria-labelledby="reconcile-explain" className="space-y-2">
          <h3 id="reconcile-explain" className="font-medium">Not known yet: say why</h3>
          {onExplain ? <>
            <p className="text-muted-foreground">The reason holds for {disagreement.reason_window_days === 1 ? '1 day' : `${disagreement.reason_window_days} days`}, and only while the roster does not change. Then this opens again.</p>
            {differing.map(figure => <div key={figure.key} className="flex flex-wrap items-end gap-2">
              <label className="block text-xs font-medium">Why {figure.label.toLowerCase()} is different
                <select className="mt-1 block min-h-10 w-full max-w-sm rounded border border-border bg-background px-3 text-sm" value={reasons[figure.key] ?? ''} disabled={!canChange}
                  onChange={event => { const value = event.target.value; setReasons(current => ({ ...current, [figure.key]: isOverrideReason(value) ? value : undefined })); }}>
                  <option value="">Choose a reason</option>{OVERRIDE_REASONS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </label>
              <Button disabled={!canChange || !reasons[figure.key]} onClick={() => { onExplain(figure, reasons[figure.key]!); onOpenChange(false); }}>Record the reason</Button>
            </div>)}
          </> : <p className="text-muted-foreground">{explainUnavailable ?? 'A reason cannot be recorded here. Fix one side.'}</p>}
        </section>
        {!canChange && <p role="status" className="text-sm">This report cannot be changed right now. Fix the roster, or reopen the report to change it.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
