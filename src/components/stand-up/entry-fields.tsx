import { Input } from '@/components/ui/input';
import { METRICS, METRIC_KEYS, emptyValues, metricDisplay, fieldDisplay, dateLabel, shiftDay, staffingPeriod, type MetricKey, type StandUpReport, type StandUpValues } from '@/lib/stand-up/model';
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
const sections = [...new Set(METRICS.map(metric => metric.section))];
export type OvertimeError = { id: string; message: string };
export function EntryQuestions({ fields, onChange, disabled, readOnly = false, week, prior, priorWeek, overtimeError }: {
  fields: EntryFields; onChange: (key: keyof EntryFields, value: string) => void; disabled: boolean; readOnly?: boolean;
  week: string; prior?: StandUpReport; priorWeek?: string; overtimeError?: OvertimeError;
}) {
  const reference = (key: MetricKey) => prior ? fieldDisplay(prior, key) : '';
  return <div className="space-y-6">{sections.map((section, index) => {
    const staffing = section.startsWith('Staffing');
    const outlook = section === 'Marketing';
    const context = staffing ? `Completed payroll week · ${staffingPeriod(week)}` : outlook ? `Expected this week · ${dateLabel(week)}–${dateLabel(shiftDay(week, 6))}` : section === 'Admissions' ? `Expected admissions and discharges for ${dateLabel(week)}–${dateLabel(shiftDay(week, 6))}. Hospital and rehab is the current count.` : 'Current figures at the time you prepare this report.';
    return <fieldset disabled={disabled} key={section} className="space-y-4 border-t border-border pt-5">
      <legend className="float-left flex w-full items-baseline gap-3"><span className="text-xs text-muted-foreground" aria-hidden="true">0{index + 1}</span><span className="font-semibold">{staffing ? 'Staffing and payroll' : section}</span></legend>
      <p className="clear-both text-sm text-muted-foreground">{context}</p>
      <div className={`grid gap-x-5 gap-y-4 ${section === 'Admissions' || section === 'Marketing' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {METRICS.filter(metric => metric.section === section).map(metric => metric.key === 'overtime_reported' ? <div key={metric.key} className="space-y-2">
          <p id="overtime-label" className="text-sm font-medium">Overtime last week</p><div role="group" aria-labelledby="overtime-label" className="grid max-w-sm grid-cols-2 gap-3">
            <label htmlFor="overtime_hours" className="text-xs text-muted-foreground">Hours<Input id="overtime_hours" aria-label="Overtime hours" aria-invalid={overtimeError ? true : undefined} aria-describedby={overtimeError?.id} readOnly={readOnly} type="number" min="0" step="1" inputMode="numeric" value={fields.overtime_hours} onChange={e => onChange('overtime_hours', e.target.value)} className="mt-1 tabular-nums" /></label>
            <label htmlFor="overtime_minutes" className="text-xs text-muted-foreground">Minutes<Input id="overtime_minutes" aria-label="Overtime minutes" aria-invalid={overtimeError ? true : undefined} aria-describedby={overtimeError?.id} readOnly={readOnly} type="number" min="0" max="59" step="1" inputMode="numeric" value={fields.overtime_minutes} onChange={e => onChange('overtime_minutes', e.target.value)} className="mt-1 tabular-nums" /></label>
          </div>{overtimeError && <p id={overtimeError.id} className="text-sm text-destructive">{overtimeError.message}</p>}<p className="text-xs text-muted-foreground">Enter hours and minutes. For example: 17 hours, 15 minutes.</p>{prior && <p className="text-xs text-muted-foreground">{priorWeek}: {reference(metric.key)}</p>}
        </div> : <label key={metric.key} htmlFor={metric.key} className="space-y-1.5 text-sm"><span className="block font-medium">{metric.label}{metric.key === 'monthly_rent_roll_cents' ? ' ($)' : ''}</span>
          <Input id={metric.key} aria-label={`${metric.label}${metric.key === 'monthly_rent_roll_cents' ? ' ($)' : ''}`} readOnly={readOnly} type="number" min="0" step={metric.key === 'monthly_rent_roll_cents' ? '0.01' : '1'} inputMode={metric.key === 'monthly_rent_roll_cents' ? 'decimal' : 'numeric'} value={fields[metric.key]} onChange={e => onChange(metric.key, e.target.value)} className="h-10 tabular-nums" />
          {metric.key === 'monthly_rent_roll_cents' && fields[metric.key] && Number.isFinite(Number(fields[metric.key])) && <span className="block text-xs text-muted-foreground">{metricDisplay(metric.key, Math.round(Number(fields[metric.key]) * 100))} per month</span>}
          {prior && <span className="block text-xs text-muted-foreground">{priorWeek}: {reference(metric.key)}</span>}
        </label>)}
      </div>
    </fieldset>;
  })}</div>;
}
