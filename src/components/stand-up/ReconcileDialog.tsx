'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chipText, figureId, showsChip, type CensusDisagreement, type DisagreementFigure } from '@/lib/stand-up/census-disagreement';
import { isOverrideReason, type OverrideReason } from '@/lib/stand-up/roster-census';
import { loadCensusDisagreements } from './CensusDisagreementChip';
import { RosterFixPanel } from './RosterFixPanel';

/**
 * COL-555: fix a census disagreement from where it is seen, in either direction.
 * Three exits, each leaving Haven consistent, none needing SQL:
 *   1. The roster is right: put the roster's figure on the report.
 *   2. The report is right: fix the roster now, inside this dialog, through the
 *      roster's own presence, discharge and arrival flows. The report is
 *      untouched; the dialog reads the disagreement again after each change
 *      and says so when the two agree.
 *   3. Neither is known yet: record why, from the facility's reason list (a
 *      setting). The reason holds for the facility's reason window, and only
 *      while the roster does not change. Monday and Thursday both record it.
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
        {!agreesNow && <section aria-labelledby="reconcile-roster-right" className="space-y-2">
          <h3 id="reconcile-roster-right" className="font-medium">The roster is right</h3>
          <p className="text-muted-foreground">Put the roster’s figure on this report.</p>
          <div className="flex flex-wrap gap-2">{differing.map(figure => <Button key={figureId(figure)} variant="outline" disabled={!canChange || figure.roster === null}
            onClick={() => { onUseRoster(figure); onOpenChange(false); }}>
            {figure.against === 'monday'
              ? `Use Monday’s ${figure.label.replace(/ against Monday$/, '').toLowerCase()} with the roster’s change: ${figure.roster ?? 'none'}`
              : `Use the roster for ${figure.label.toLowerCase()}: ${figure.roster ?? 'none'}`}</Button>)}</div>
        </section>}
        <section aria-labelledby="reconcile-report-right" className="space-y-2">
          <h3 id="reconcile-report-right" className="font-medium">The report is right: fix the roster now</h3>
          <p className="text-muted-foreground">Record the arrival, discharge, hospital stay or return that is missing. The report stays as it is, and this clears when the roster matches.</p>
          {canFixRoster
            ? <RosterFixPanel facilityId={current.facility_id} facilityName={current.facility_name} onRosterChanged={() => void checkAgain()} />
            : <p className="text-muted-foreground">Ask the facility administrator to fix the roster.</p>}
          <Button variant="ghost" size="sm" disabled={checking} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</Button>
        </section>
        {!agreesNow && <section aria-labelledby="reconcile-explain" className="space-y-2">
          <h3 id="reconcile-explain" className="font-medium">Not known yet: say why</h3>
          {!onExplain ? <p className="text-muted-foreground">{explainUnavailable ?? 'A reason cannot be recorded here. Fix one side.'}</p>
            : options.length === 0 ? <p className="text-muted-foreground">This facility’s reasons could not be read. Fix one side, or try again later.</p>
            : <>
              <p className="text-muted-foreground">The reason holds for {current.reason_window_days === 1 ? '1 day' : `${current.reason_window_days} days`}, and only while the roster does not change. Then this opens again.</p>
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
                  <Button disabled={!canChange || !reasons[figure.key]} onClick={() => { onExplain(figure, reasons[figure.key]!); onOpenChange(false); }}>Record the reason<span className="sr-only"> for {label}</span></Button>
                </div>;
              })}
            </>}
        </section>}
        {!canChange && !agreesNow && <p role="status" className="text-sm">This report cannot be changed right now. Fix the roster, or reopen the report to change it.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
