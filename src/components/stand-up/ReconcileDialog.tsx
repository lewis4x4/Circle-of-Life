'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chipText, figureId, showsChip, type CensusDisagreement, type DisagreementFigure } from '@/lib/stand-up/census-disagreement';
import { isOverrideReason, type OverrideReason } from '@/lib/stand-up/roster-census';
import { loadCensusDisagreements } from './CensusDisagreementChip';
import { RosterFixPanel } from './RosterFixPanel';

/**
 * COL-555: fix a census disagreement from where it is seen.
 *
 * Brian, 2026-09-25: "there should not ever be a difference. I would expect the
 * admin to fix it right then and there." So the dialog leads with the fix:
 *   1. Fix the roster now (primary, open): the roster's own presence, discharge
 *      and arrival flows, inside this dialog. The report is untouched; the
 *      dialog reads the disagreement again after each change and says so when
 *      the two agree.
 *   2. The roster is already right: put its figure (or, against Monday, the
 *      census bridge's expected figure) on the report.
 *   3. Only when neither can be fixed yet, behind a disclosure: record why,
 *      from the facility's reason list (a setting). The reason holds for the
 *      facility's reason window, and only while the roster does not change.
 */
export function ReconcileDialog({ disagreement, open, onOpenChange, onUseRoster, onExplain, onCheckAgain, canChange, canFixRoster = true, explainUnavailable }: {
  disagreement: CensusDisagreement
  open: boolean
  onOpenChange: (open: boolean) => void
  onUseRoster: (figure: DisagreementFigure) => void
  /** Absent where a reason cannot be recorded here. */
  onExplain?: (figure: DisagreementFigure, reason: OverrideReason) => void
  /** Called after the roster changed (or the reader asked to check again), so the page re-reads its roster and chip. */
  onCheckAgain: () => void
  /** False when the report cannot be changed right now (read-only, submitted, not open). */
  canChange: boolean
  /** False for a reader who cannot change the roster (the roster's own permissions still decide). */
  canFixRoster?: boolean
  explainUnavailable?: string
}) {
  const [current, setCurrent] = useState(disagreement);
  const [checking, setChecking] = useState(false);
  const differing = current.figures.filter(figure => figure.state === 'open' || figure.state === 'explained');
  // One reason per figure: it explains the roster and the Monday comparison alike.
  const explainable = differing.filter((figure, index) => differing.findIndex(other => other.key === figure.key) === index);
  const [reasons, setReasons] = useState<Partial<Record<DisagreementFigure['key'], OverrideReason>>>({});
  const options = current.reason_options;
  const agreesNow = !showsChip(current);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    const rows = await loadCensusDisagreements(current.facility_id);
    const row = rows?.find(item => item.facility_id === current.facility_id && item.meeting_day === current.meeting_day);
    if (row) setCurrent(row);
    setChecking(false);
    onCheckAgain();
  }, [current.facility_id, current.meeting_day, onCheckAgain]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Reconcile census · {current.facility_name}</DialogTitle>
        <DialogDescription>{agreesNow ? 'The report and the roster agree now. Nothing is left to reconcile.' : chipText(current)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-5 text-sm">
        {agreesNow && <p role="status">Reconciled. The notice and the chip clear on every page.</p>}
        {!agreesNow && <p className="font-medium">The report and the roster should never differ. Fix it now; give a reason only if it cannot be fixed yet.</p>}
        <section aria-labelledby="reconcile-fix-roster" className="space-y-3 rounded-lg border-2 border-primary bg-primary/5 p-4" data-reconcile-step="fix">
          <h3 id="reconcile-fix-roster" className="text-base font-semibold">Fix the roster now</h3>
          <p>Record the arrival, discharge, hospital or rehab stay, or return that is missing, with when it happened. The report stays as it is, and this clears when the two agree.</p>
          {canFixRoster
            ? <RosterFixPanel facilityId={current.facility_id} facilityName={current.facility_name} onRosterChanged={() => void checkAgain()} defaultOpen />
            : <p>Ask the facility administrator to fix the roster.</p>}
          <Button disabled={checking} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</Button>
        </section>
        {!agreesNow && <section aria-labelledby="reconcile-roster-right" className="space-y-2" data-reconcile-step="use-roster">
          <h3 id="reconcile-roster-right" className="font-medium">The roster is already right</h3>
          <p className="text-muted-foreground">Then the report is wrong. Put the roster’s figure on it.</p>
          <div className="flex flex-wrap gap-2">{differing.map(figure => <Button key={figureId(figure)} variant="outline" disabled={!canChange || figure.roster === null}
            onClick={() => { onUseRoster(figure); onOpenChange(false); }}>
            {figure.against === 'monday'
              ? `Use the expected ${figure.label.replace(/ against Monday$/, '').toLowerCase()} from Monday: ${figure.roster ?? 'none'}`
              : `Use the roster for ${figure.label.toLowerCase()}: ${figure.roster ?? 'none'}`}</Button>)}</div>
          {!canChange && <p role="status">This report cannot be changed right now. Fix the roster, or reopen the report to change it.</p>}
        </section>}
        {!agreesNow && <details className="rounded border border-border p-3" data-reconcile-step="reason">
          <summary className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Cannot fix it yet? Give a reason</summary>
          <div className="mt-2 space-y-2">
            {!onExplain ? <p className="text-muted-foreground">{explainUnavailable ?? 'A reason cannot be recorded here. Fix one side.'}</p>
              : options.length === 0 ? <p className="text-muted-foreground">This facility’s reasons could not be read. Fix one side, or try again later.</p>
              : <>
                <p className="text-muted-foreground">A reason is a stopgap, not a fix. It holds for {current.reason_window_days === 1 ? '1 day' : `${current.reason_window_days} days`}, and only while the roster does not change. Then this opens again.</p>
                {explainable.map(figure => {
                  const label = figure.label.replace(/ against Monday$/, '').toLowerCase();
                  const id = `reconcile-reason-${figure.key}`;
                  return <div key={figure.key} className="flex flex-wrap items-end gap-2">
                    <label htmlFor={id} className="block text-xs font-medium">Why {label} is different
                      <select id={id} className="mt-1 block min-h-10 w-full max-w-sm rounded border border-border bg-background px-3 text-sm" value={reasons[figure.key] ?? ''} disabled={!canChange}
                        onChange={event => { const value = event.target.value; setReasons(prev => ({ ...prev, [figure.key]: isOverrideReason(value, options) ? value : undefined })); }}>
                        <option value="">Choose a reason</option>{options.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                      </select>
                    </label>
                    <Button variant="outline" disabled={!canChange || !reasons[figure.key]} onClick={() => { onExplain(figure, reasons[figure.key]!); onOpenChange(false); }}>Record the reason<span className="sr-only"> for {label}</span></Button>
                  </div>;
                })}
              </>}
          </div>
        </details>}
      </div>
    </DialogContent>
  </Dialog>;
}
