import type { ReactNode } from 'react';
import { Check, CircleAlert, Minus } from 'lucide-react';
import { reportStamp, bridgeSentence, bridgeStateLabel, bridgeTerms, type CensusBridge as Bridge } from '@/lib/stand-up/thursday-report';

/**
 * COL-749 ruling 3: the census bridge at the top of a building's Thursday
 * section (the entry form, the report under it and the printout).
 *
 *   Monday 34  + 2 arrivals  − 1 departure  1 hospital or rehab out (in census)  1 return (in census)  = 35 expected   Thursday 35  ✓ Matches
 *
 * A resident at a hospital or in rehab still counts in census (Brian,
 * 2026-09-25), so those terms are shown but do not change the expected figure.
 *
 * Green with a check when Thursday matches, red with the gap when it does not
 * (plus the Reconcile action the caller passes). The whole bridge is also one
 * sentence for screen readers, so the numbers are heard, never only a colour.
 * Colours are design tokens; on paper the icon and the words carry it.
 */
export function CensusBridge({ bridge, action, headingLevel = 3 }: { bridge: Bridge; action?: ReactNode; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const tone = bridge.state === 'matches' ? 'border-success bg-success/10'
    : bridge.state === 'differs' ? 'border-destructive bg-destructive/10'
    : 'border-border bg-muted/30';
  const sentence = bridgeSentence(bridge);
  const hasMonday = bridge.state !== 'no_monday' && bridge.monday_census !== null && bridge.expected !== null;
  return <section aria-label="Census bridge from Monday" data-bridge-state={bridge.state}
    className={`space-y-2 rounded border-2 p-3 text-sm break-inside-avoid print:border-foreground print:bg-transparent ${tone}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <H className="font-semibold">Census bridge: Monday to Thursday</H>
      <BridgeBadge bridge={bridge} />
    </div>
    <p className="sr-only" role="status">{sentence}</p>
    {hasMonday ? <div aria-hidden className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
      <span className="font-medium">Monday {bridge.monday_census}</span>
      {bridgeTerms(bridge).map(term => <span key={term.key} className={term.movesCensus ? '' : 'text-muted-foreground'}>
        {term.movesCensus ? `${term.sign} ${term.label}` : `${term.label} (in census)`}
      </span>)}
      <span className="font-semibold">= {bridge.expected} expected</span>
      <span className="font-semibold">Thursday {bridge.actual ?? 'not entered'}</span>
    </div>
      : <p aria-hidden>Monday’s census for this week was not submitted, so there is nothing to bridge from.</p>}
    <p aria-hidden className="text-xs text-muted-foreground">
      {bridge.monday_at ? `Movements dated after Monday’s figures (${reportStamp(bridge.monday_at)})` : 'Movements by the date they happened'}
      {bridge.through ? ` through ${bridge.state === 'not_entered' ? 'now' : `Thursday’s figures (${reportStamp(bridge.through)})`}` : ''}.
      {bridge.tolerance > 0 ? ` A difference of up to ${bridge.tolerance} matches.` : ''}
      {bridge.hospital_in_census ? ' Hospital and rehab stays stay in census, as the roster counts them.' : ''}
    </p>
    {bridge.state === 'differs' && action ? <div className="print:hidden">{action}</div> : null}
  </section>;
}

function BridgeBadge({ bridge }: { bridge: Bridge }) {
  const label = bridgeStateLabel(bridge);
  if (bridge.state === 'matches') {
    return <span aria-hidden className="inline-flex items-center gap-1 rounded border border-success px-2 py-0.5 font-semibold text-success"><Check className="size-4" />{label}</span>;
  }
  if (bridge.state === 'differs') {
    return <span aria-hidden className="inline-flex items-center gap-1 rounded border border-destructive px-2 py-0.5 font-semibold text-destructive"><CircleAlert className="size-4" />{label}</span>;
  }
  return <span aria-hidden className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground"><Minus className="size-4" />{label}</span>;
}
