import { METRICS, type MetricKey, type SectionKey } from './model'

/**
 * What each figure counts.
 *
 * Source of truth: the Stand Up reporting contract recorded in
 * `docs/specs/24-stand-up-pilot.md` and its authoritative context,
 * `Haven Drive Discovery 2026-09-10/STAND-UP-CONTRACT.md`. The owner settled
 * twelve of the fourteen open counting rules on 2026-09-15 (COL-374); the
 * wording below is those rulings, not an engineering interpretation of them.
 *
 * One short sentence each. A figure Haven still cannot check against anything
 * is named in `UNCHECKED_FIGURES`, not explained under its input.
 */
export const FIELD_DEFINITIONS: Record<MetricKey, string> = {
  monthly_rent_roll_cents: 'Current monthly rent roll — the workbook’s Current AR — as it stands Monday morning.',
  current_total_census: 'Residents holding a bed Monday morning, including anyone away whose bed is held.',
  hospital_and_rehab_total: 'Residents away at a hospital or in rehab Monday morning. Their bed is held, so they stay on census.',
  sp_female_beds_open: 'Open semi-private beds in a room whose other resident is a woman.',
  sp_male_beds_open: 'Open semi-private beds in a room whose other resident is a man.',
  sp_flexible_beds_open: 'Open semi-private beds in a room with no resident, so either a man or a woman could take one.',
  private_beds_open: 'Open private beds. A bed opens when its resident is discharged; reserved, maintenance and offline beds are not open.',
  admissions_expected: 'Admissions you expect this week, not admissions already made.',
  expected_discharges: 'Discharges you expect this week, where notice has been given or the decision is known.',
  callouts_last_week: 'Scheduled shifts missed to a callout in the completed payroll week. Approved time off is not a callout, and leaving early is not a missed shift.',
  terminations_last_week: 'Terminations in the completed payroll week, by the effective separation date on the employee record.',
  current_open_positions: 'Budgeted positions still unfilled Monday morning. A seat covered by agency or PRN staff is still open.',
  overtime_reported: 'Overtime in the completed payroll week, as whole hours and minutes. For example: 17 hours, 15 minutes.',
  tours_expected: 'Tours you expect this week.',
  provider_activities_expected: 'Home-health provider marketing activities on this week’s calendar — in-services, screenings and health fairs. Not clinical visits to residents.',
  outreach_engagements: 'In-person outreach and engagements with providers, facilities and events this week. Emails and calls are not counted.',
}

/**
 * Figures the company has defined but Haven holds no record to check against,
 * so the administrator's own count stands and nothing verifies it. Each line
 * says what is missing, not what the figure means.
 *
 * Remove a line only when the record exists — never because the wording looks
 * unfinished. `current_open_positions` waits on the budgeted establishment
 * (COL-416); `overtime_reported` waits on the approved payroll source and a
 * confirmed Monday–Sunday payroll week (COL-417).
 */
export const UNCHECKED_FIGURES: Partial<Record<MetricKey, string>> = {
  current_open_positions: 'Haven does not record how many positions each facility is budgeted for.',
  overtime_reported: 'Haven has no approved time source to check the hours against.',
}

/** A rule the company has agreed that governs a whole section, stated once. */
export const SECTION_NOTES: Partial<Record<SectionKey, string>> = {
  beds: 'Total open beds adds these four figures, so count each open bed in one category only.',
}

/** A derived figure, named for what it actually is, with its calculation. */
export const DERIVED_NOTES: Partial<Record<SectionKey, { term: string; detail: string }>> = {
  census: { term: 'Monthly rent roll per census resident', detail: 'Monthly rent roll ÷ current census. Census counts beds held, including held beds whose resident is away, so this is not revenue per paying resident.' },
}

export const fieldHelp = (key: MetricKey): string => FIELD_DEFINITIONS[key]
export const uncheckedNote = (key: MetricKey): string | null => UNCHECKED_FIGURES[key] ?? null

/** Figures Haven cannot yet check against a record of its own, in report order. */
export const UNCHECKED_KEYS: MetricKey[] = METRICS.map(metric => metric.key).filter(key => key in UNCHECKED_FIGURES)
export const sectionUncheckedCount = (section: SectionKey): number =>
  METRICS.filter(metric => metric.section === section && metric.key in UNCHECKED_FIGURES).length

/**
 * The qualification those figures carry, said once. The current-snapshot
 * sections no longer need one: the owner settled that they describe the ALF as
 * it stands Monday morning, which is the time Haven records on save.
 */
export const REPORTING_QUALIFICATION =
  'Haven holds no record of its own to check these against, so the administrator’s count stands and nothing verifies it. A change in one of them is not yet evidence.'
