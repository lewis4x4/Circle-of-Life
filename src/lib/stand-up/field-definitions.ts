import { METRICS, type MetricKey, type SectionKey } from './model'

/**
 * What each figure counts.
 *
 * Source of truth: the Stand Up reporting contract recorded in
 * `docs/specs/24-stand-up-pilot.md` and its authoritative context,
 * `Haven Drive Discovery 2026-09-10/STAND-UP-CONTRACT.md`.
 *
 * One short sentence each, and nothing else: no unresolved counting rule, and
 * no remark about how a label was worded in an earlier workbook. An unresolved
 * rule is a reporting question, not field help, so it lives in
 * `PENDING_DEFINITIONS` and the form states the whole set once.
 */
export const FIELD_DEFINITIONS: Record<MetricKey, string> = {
  monthly_rent_roll_cents: 'Current monthly rent roll — the workbook’s Current AR.',
  current_total_census: 'Residents on census now.',
  hospital_and_rehab_total: 'Residents away at a hospital or in rehab right now.',
  sp_female_beds_open: 'Open semi-private beds a woman can move into now.',
  sp_male_beds_open: 'Open semi-private beds a man can move into now.',
  sp_flexible_beds_open: 'Open semi-private beds that could go to a man or a woman.',
  private_beds_open: 'Open private beds.',
  admissions_expected: 'Admissions you expect this week, not admissions already made.',
  expected_discharges: 'Discharges you expect this week.',
  callouts_last_week: 'Callouts in the completed payroll week.',
  terminations_last_week: 'Terminations in the completed payroll week.',
  current_open_positions: 'Open positions in the completed payroll week.',
  overtime_reported: 'Overtime in the completed payroll week, as whole hours and minutes. For example: 17 hours, 15 minutes.',
  tours_expected: 'Tours you expect this week.',
  provider_activities_expected: 'Home-health provider activities on this week’s calendar.',
  outreach_engagements: 'Outreach and engagements with providers, facilities and events this week.',
}

/**
 * Counting rules Circle of Life has not agreed yet, each stated as the open
 * question rather than a rule. Haven does not invent one: a guessed rule would
 * make figures from different ALFs look comparable when they are not.
 *
 * These are tracked as one company decision, COL-374, whose authorized decision
 * maker is the Circle of Life owner. Remove a line here only when that decision
 * records the answer — never because the wording looks unfinished.
 */
export const PENDING_DEFINITIONS: Partial<Record<MetricKey, string>> = {
  monthly_rent_roll_cents: 'The as-of point this figure describes.',
  current_total_census: 'Which residents are counted, and the as-of point.',
  hospital_and_rehab_total: 'Whether they stay on census, and whether their beds are held.',
  sp_female_beds_open: 'Semi-private eligibility rules.',
  sp_male_beds_open: 'Semi-private eligibility rules.',
  sp_flexible_beds_open: 'Semi-private eligibility rules.',
  private_beds_open: 'How reserved and out-of-service beds count.',
  expected_discharges: 'How far ahead a discharge has to fall to be counted.',
  callouts_last_week: 'Whether one callout is an employee, a shift or an occurrence.',
  terminations_last_week: 'Which date puts a termination inside the week.',
  current_open_positions: 'Vacancies open at the end of the week, or every vacancy during it.',
  overtime_reported: 'The time source Haven will check this against.',
  provider_activities_expected: 'What counts as one activity.',
  outreach_engagements: 'The counting rule.',
}

/** A rule the company has agreed that governs a whole section, stated once. */
export const SECTION_NOTES: Partial<Record<SectionKey, string>> = {
  beds: 'Total open beds adds these four figures, so count each open bed in one category only.',
}

/** A derived figure, named for what it actually is, with its calculation. */
export const DERIVED_NOTES: Partial<Record<SectionKey, { term: string; detail: string }>> = {
  census: { term: 'Monthly rent roll per census resident', detail: 'Monthly rent roll ÷ current census. Not a checked resident-level average of what residents are charged.' },
}

export const fieldHelp = (key: MetricKey): string => FIELD_DEFINITIONS[key]
export const pendingDefinition = (key: MetricKey): string | null => PENDING_DEFINITIONS[key] ?? null

/** Figures whose counting rule the company has not settled, in report order. */
export const UNRESOLVED_DEFINITIONS: MetricKey[] = METRICS.map(metric => metric.key).filter(key => key in PENDING_DEFINITIONS)
export const sectionUnresolvedCount = (section: SectionKey): number =>
  METRICS.filter(metric => metric.section === section && metric.key in PENDING_DEFINITIONS).length

/**
 * The qualification the whole report carries while those rules are open, said
 * once. It also names what the recorded current-snapshot time is, because
 * Haven stamps that time when figures reach it — on a save, or when the
 * connector reads the workbook — and the as-of point the figures are meant to
 * describe is itself one of the open questions.
 */
export const REPORTING_QUALIFICATION =
  'Circle of Life has not agreed how these figures are counted, and the current-snapshot sections have no agreed as-of point. The recorded time is when the figures reached Haven, not a separate observation time. Enter what your ALF counts today; until the rules are settled, treat these figures as provisional and not comparable between ALFs.'
