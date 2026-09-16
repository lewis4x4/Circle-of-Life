import { Input } from '@/components/ui/input';
import { METRIC_KEYS, SECTIONS, dollars, emptyValues, metricDisplay, fieldDisplay, sectionMetrics, sectionPeriodLabel, FIELD_STATE_TEXT, type DerivedFigures, type MetricKey, type SectionKey, type StandUpReport, type StandUpValues } from '@/lib/stand-up/model';
import { DERIVED_NOTES, SECTION_NOTES, fieldHelp, uncheckedNote, sectionUncheckedCount } from '@/lib/stand-up/field-definitions';
import { legacyOvertimeToMinutes, overtimeMinuteParts, overtimePartsToLegacy } from '@/lib/stand-up/duration';

export type EntryFields = Record<MetricKey, string> & { overtime_hours: string; overtime_minutes: string };
export function fieldsFor(values: StandUpValues = emptyValues()): EntryFields {
  let duration = { hours: '', minutes: '' };
  try { duration = overtimeMinuteParts(legacyOvertimeToMinutes(values.overtime_reported)); } catch { /* Invalid legacy durations require explicit correction. */ }
  return { ...Object.fromEntries(METRIC_KEYS.map(key => [key, values[key] === null ? '' : String(key === 'monthly_rent_roll_cents' ? values[key]! / 100 : values[key])])), overtime_hours: duration.hours, overtime_minutes: duration.minutes } as EntryFields;
}
export function entryValues(fields: EntryFields): StandUpValues {
  const money = fields.monthly_rent_roll_cents.trim();
  if (money && !/^\d+(\.\d{1,2})?$/.test(money)) throw new Error('Monthly rent roll: enter dollars with up to two decimal places.');
  return { ...Object.fromEntries(METRIC_KEYS.map(key => [key, fields[key].trim() === '' ? null : key === 'monthly_rent_roll_cents' ? Math.round(Number(fields[key]) * 100) : Number(fields[key])])), overtime_reported: overtimePartsToLegacy(fields.overtime_hours, fields.overtime_minutes) } as StandUpValues;
}
export const sectionDomId = (key: SectionKey) => `stand-up-section-${key}`;
export type OvertimeError = { id: string; message: string };

/** Jump row so a long form can be entered section by section. */
export function SectionNav() {
  return <nav aria-label="Report sections" className="flex flex-wrap gap-2">
    {SECTIONS.map(section => <a key={section.key} href={`#${sectionDomId(section.key)}`} className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{section.label}</a>)}
  </nav>;
}

/**
 * Sticky chrome at both ends of the page: the shell's top bar and the save bar.
 * Section jumps land below the top bar, and a focused input near the end of the
 * form scrolls clear of the save bar instead of underneath it.
 */
const SECTION_SCROLL = 'scroll-mt-20';
const INPUT_SCROLL = 'scroll-mb-48';

/**
 * A field shows its label, its input and its previous figure. The definition —
 * and, where Haven has nothing to check the figure against, what is missing —
 * sits in one disclosure per section, so an administrator entering a figure
 * reads a label rather than a paragraph, and can still reach the meaning
 * without leaving the page.
 */
function SectionDefinitions({ section }: { section: SectionKey }) {
  const unchecked = sectionUncheckedCount(section);
  const derived = DERIVED_NOTES[section];
  return <details className="text-xs">
    {/* Keep the browser's disclosure marker: `inline-block` would replace
        `display: list-item` and leave the row looking like ordinary text. */}
    <summary className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      What these figures count{unchecked > 0 ? ` · ${unchecked} Haven cannot check` : ''}
    </summary>
    <dl className="mt-2 space-y-2 border-l-2 border-border pl-3">
      {sectionMetrics(section).map(metric => {
        const missing = uncheckedNote(metric.key);
        return <div key={metric.key}>
          <dt className="font-medium">{metric.label}</dt>
          <dd className="text-muted-foreground">{fieldHelp(metric.key)}{missing ? ` ${missing}` : ''}</dd>
        </div>;
      })}
      {derived && <div><dt className="font-medium">{derived.term}</dt><dd className="text-muted-foreground">{derived.detail}</dd></div>}
    </dl>
  </details>;
}

export function EntryQuestions({ fields, onChange, disabled, readOnly = false, week, open = false, prior, asOf, derived, overtimeError }: {
  fields: EntryFields; onChange: (key: keyof EntryFields, value: string) => void; disabled: boolean; readOnly?: boolean;
  week: string; open?: boolean; prior?: StandUpReport; asOf?: string | null; derived: DerivedFigures | null; overtimeError?: OvertimeError;
}) {
  // A previous forecast is not evidence of what happened, so the reference label
  // says which kind of figure it is rather than repeating a bare date.
  const referenceLabel = (period: string) => period === 'expected' ? 'Previous forecast' : 'Previous report';
  const reference = (key: MetricKey, period: string) => prior ? <span className="block text-xs text-muted-foreground">{referenceLabel(period)}: {fieldDisplay(prior, key)}</span> : null;
  return <div className="space-y-6">{SECTIONS.map((section, index) => {
    const metrics = sectionMetrics(section.key);
    return <fieldset id={sectionDomId(section.key)} tabIndex={-1} disabled={disabled} key={section.key} className={`space-y-3 border-t border-border pt-5 outline-none ${SECTION_SCROLL}`}>
      <legend className="float-left flex w-full items-baseline gap-3"><span className="text-xs text-muted-foreground" aria-hidden="true">0{index + 1}</span><span className="font-semibold">{section.label}</span></legend>
      <p className="clear-both text-sm font-medium">{sectionPeriodLabel(section, week, asOf, open)}</p>
      {section.period === 'expected' && <p className="text-xs text-muted-foreground">Enter what you expect, not what has already happened.</p>}
      {SECTION_NOTES[section.key] && <p className="text-xs text-muted-foreground">{SECTION_NOTES[section.key]}</p>}
      <div className={`grid gap-x-5 gap-y-4 pt-1 ${metrics.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {metrics.map(metric => metric.key === 'overtime_reported' ? <div key={metric.key} className="space-y-1.5">
          <p id="overtime-label" className="text-sm font-medium">Overtime last week</p><div role="group" aria-labelledby="overtime-label" className="grid max-w-sm grid-cols-2 gap-3">
            <label htmlFor="overtime_hours" className="text-xs text-muted-foreground">Hours<Input id="overtime_hours" aria-label="Overtime hours" aria-invalid={overtimeError ? true : undefined} aria-describedby={overtimeError?.id} readOnly={readOnly} type="number" min="0" step="1" inputMode="numeric" value={fields.overtime_hours} onChange={e => onChange('overtime_hours', e.target.value)} className={`mt-1 tabular-nums ${INPUT_SCROLL}`} /></label>
            <label htmlFor="overtime_minutes" className="text-xs text-muted-foreground">Minutes<Input id="overtime_minutes" aria-label="Overtime minutes" aria-invalid={overtimeError ? true : undefined} aria-describedby={overtimeError?.id} readOnly={readOnly} type="number" min="0" max="59" step="1" inputMode="numeric" value={fields.overtime_minutes} onChange={e => onChange('overtime_minutes', e.target.value)} className={`mt-1 tabular-nums ${INPUT_SCROLL}`} /></label>
          </div>{overtimeError && <p id={overtimeError.id} className="text-sm text-muted-foreground">{overtimeError.message}</p>}{reference(metric.key, section.period)}
        </div> : <label key={metric.key} htmlFor={metric.key} className="space-y-1.5 text-sm"><span className="block font-medium">{metric.label}{metric.key === 'monthly_rent_roll_cents' ? ' ($)' : ''}</span>
          <Input id={metric.key} aria-label={`${metric.label}${metric.key === 'monthly_rent_roll_cents' ? ' ($)' : ''}`} readOnly={readOnly} type="number" min="0" step={metric.key === 'monthly_rent_roll_cents' ? '0.01' : '1'} inputMode={metric.key === 'monthly_rent_roll_cents' ? 'decimal' : 'numeric'} value={fields[metric.key]} onChange={e => onChange(metric.key, e.target.value)} className={`h-10 tabular-nums ${INPUT_SCROLL}`} />
          {metric.key === 'monthly_rent_roll_cents' && fields[metric.key] && Number.isFinite(Number(fields[metric.key])) && <span className="block text-xs text-muted-foreground">{metricDisplay(metric.key, Math.round(Number(fields[metric.key]) * 100))} per month</span>}
          {reference(metric.key, section.period)}
        </label>)}
      </div>
      {/* A derived figure sits with the fields it comes from, named for what it
          actually is; its calculation is one line down, in the definitions. */}
      {section.key === 'census' && <p className="text-xs text-muted-foreground">{DERIVED_NOTES.census!.term}: {dollars(derived?.average_rent_cents ?? null)}</p>}
      {section.key === 'beds' && <p className="text-xs text-muted-foreground">Total open beds: {derived?.total_beds_open ?? FIELD_STATE_TEXT.not_provided}</p>}
      <SectionDefinitions section={section.key} />
    </fieldset>;
  })}</div>;
}
