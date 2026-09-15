import type { MetricKey, SectionKey } from './model'

/**
 * What each figure counts, and where the counting rule is still unresolved.
 *
 * Source of truth: the Stand Up reporting contract recorded in
 * `docs/specs/24-stand-up-pilot.md` and its authoritative context,
 * `Haven Drive Discovery 2026-09-10/STAND-UP-CONTRACT.md`. Several rows of that
 * contract carry an explicit "definition pending" note. Those stay pending here
 * and are shown to the administrator as pending; Haven does not invent a rule
 * the company has not agreed, because a guessed rule would make figures from
 * different ALFs look comparable when they are not.
 *
 * Keep each line to one short sentence plus, at most, one pending clause.
 * A rule shared by a whole section belongs in `SECTION_NOTES`, not repeated
 * under every field. Remove a pending clause only when the owner has recorded
 * the decision — never because the wording looks unfinished.
 */
export const FIELD_DEFINITIONS: Record<MetricKey, string> = {
  monthly_rent_roll_cents: 'Current monthly rent roll — the workbook’s Current AR. As-of point pending.',
  current_total_census: 'Residents on census now. Pending: which residents count, and the as-of point.',
  hospital_and_rehab_total: 'Residents away at a hospital or in rehab right now. Pending: whether they stay on census and whether their beds are held.',
  sp_female_beds_open: 'Open semi-private beds a woman can move into now.',
  sp_male_beds_open: 'Open semi-private beds a man can move into now.',
  sp_flexible_beds_open: 'Open semi-private beds that could go to a man or a woman.',
  private_beds_open: 'Open private beds. Pending: how reserved and out-of-service beds count.',
  admissions_expected: 'Admissions you expect this week, not admissions already made.',
  expected_discharges: 'Discharges you expect this week. Horizon pending.',
  callouts_last_week: 'Callouts in the completed payroll week. Counting rule pending: employees, shifts or occurrences.',
  terminations_last_week: 'Terminations in the completed payroll week. Pending: which date puts one inside the week.',
  current_open_positions: 'Open positions for the completed payroll week, despite the carried-over "current" wording. Pending: vacancies at week end or every vacancy during the week.',
  overtime_reported: 'Overtime in the completed payroll week. Pending: the time source Haven will check it against.',
  tours_expected: 'Tours you expect this week.',
  provider_activities_expected: 'Home-health provider activities on this week’s calendar. Pending: what counts as one activity.',
  outreach_engagements: 'Outreach and engagements with providers, facilities and events this week. Counting rule pending.',
}

/** A rule that governs a whole section, stated once rather than per field. */
export const SECTION_NOTES: Partial<Record<SectionKey, string>> = {
  beds: 'Total open beds adds these four figures, so count each open bed in one category only. Semi-private eligibility rules pending.',
}

export const fieldHelp = (key: MetricKey): string => FIELD_DEFINITIONS[key]

/** Figures whose counting rule the company has not settled yet. */
export const UNRESOLVED_DEFINITIONS = (Object.keys(FIELD_DEFINITIONS) as MetricKey[]).filter(key => /pending/i.test(FIELD_DEFINITIONS[key]))
