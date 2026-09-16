import { describe, expect, it } from 'vitest'
import { DERIVED_NOTES, FIELD_DEFINITIONS, REPORTING_QUALIFICATION, SECTION_NOTES, UNCHECKED_FIGURES, UNCHECKED_KEYS, fieldHelp, uncheckedNote, sectionUncheckedCount } from './field-definitions'
import { METRIC_KEYS } from './model'

describe('Stand Up field definitions', () => {
 it('defines every figure and nothing that is not a figure', () => {
  expect(Object.keys(FIELD_DEFINITIONS).sort()).toEqual([...METRIC_KEYS].sort())
  expect(METRIC_KEYS.every(key => fieldHelp(key).length > 0)).toBe(true)
 })
 it('keeps unfinished reporting questions out of ordinary field help', () => {
  // An open question is for the company, not an instruction for the administrator,
  // so it never reaches the sentence shown beside a figure.
  for (const key of METRIC_KEYS) expect(FIELD_DEFINITIONS[key]).not.toMatch(/pending|not settled|unresolved|tbd/i)
  // Nor does a note about how an earlier workbook happened to word a label.
  for (const key of METRIC_KEYS) expect(FIELD_DEFINITIONS[key]).not.toMatch(/carried-over|despite the|wording/i)
  for (const text of Object.values(SECTION_NOTES)) expect(text).not.toMatch(/pending|not settled/i)
 })
 it('carries the counting rules the owner settled on 2026-09-15 (COL-374)', () => {
  // Census is the beds: matches haven.resident_status_holds_bed in migration 388.
  expect(FIELD_DEFINITIONS.current_total_census).toBe('Residents holding a bed Monday morning, including anyone away whose bed is held.')
  expect(FIELD_DEFINITIONS.hospital_and_rehab_total).toContain('Their bed is held, so they stay on census.')
  // A bed opens on discharge; a reserved or out-of-service bed is not open.
  expect(FIELD_DEFINITIONS.private_beds_open).toContain('opens when its resident is discharged')
  expect(FIELD_DEFINITIONS.private_beds_open).toContain('reserved, maintenance and offline beds are not open')
  // Semi-private is decided by the roommate's sex; COL does not place mixed-sex pairs,
  // so there is no mixed category, and suitability stays a placement judgment.
  expect(FIELD_DEFINITIONS.sp_female_beds_open).toBe('Open semi-private beds in a room whose other resident is a woman.')
  expect(FIELD_DEFINITIONS.sp_male_beds_open).toBe('Open semi-private beds in a room whose other resident is a man.')
  expect(FIELD_DEFINITIONS.sp_flexible_beds_open).toContain('a room with no resident')
  for (const key of ['sp_female_beds_open', 'sp_male_beds_open', 'sp_flexible_beds_open', 'private_beds_open'] as const) {
   expect(FIELD_DEFINITIONS[key]).not.toMatch(/mixed|couple|dementia|smok/i)
  }
  // A callout is a missed scheduled shift, and leaving early is not one.
  expect(FIELD_DEFINITIONS.callouts_last_week).toContain('Scheduled shifts missed to a callout')
  expect(FIELD_DEFINITIONS.callouts_last_week).toContain('leaving early is not a missed shift')
  expect(FIELD_DEFINITIONS.terminations_last_week).toContain('effective separation date')
  expect(FIELD_DEFINITIONS.expected_discharges).toContain('notice has been given')
  expect(FIELD_DEFINITIONS.current_open_positions).toContain('agency or PRN')
  // Marketing counts relationship activity, not clinical visit volume.
  expect(FIELD_DEFINITIONS.provider_activities_expected).toContain('Not clinical visits to residents.')
  expect(FIELD_DEFINITIONS.outreach_engagements).toContain('Emails and calls are not counted.')
 })
 it('leaves only the two figures Haven has no record to check', () => {
  // Open positions waits on the budgeted establishment (COL-416); overtime waits
  // on an approved payroll source and a confirmed payroll week (COL-417).
  expect(UNCHECKED_KEYS).toEqual(['current_open_positions', 'overtime_reported'])
  expect(Object.keys(UNCHECKED_FIGURES).sort()).toEqual([...UNCHECKED_KEYS].sort())
  expect(uncheckedNote('current_total_census')).toBeNull()
  expect(uncheckedNote('overtime_reported')).toBe('Haven has no approved time source to check the hours against.')
  expect(sectionUncheckedCount('staffing')).toBe(2)
  expect(sectionUncheckedCount('census')).toBe(0)
  expect(sectionUncheckedCount('beds')).toBe(0)
  expect(sectionUncheckedCount('marketing')).toBe(0)
 })
 it('says once what an unverified figure rests on, without claiming a rule is missing', () => {
  expect(REPORTING_QUALIFICATION).toContain('no record of its own to check these against')
  expect(REPORTING_QUALIFICATION).toContain('not yet evidence')
  expect(REPORTING_QUALIFICATION).not.toMatch(/as-of|counting rule/i)
 })
 it('names the derived ratio for what it is, including what the census denominator holds', () => {
  expect(DERIVED_NOTES.census?.term).toBe('Monthly rent roll per census resident')
  expect(DERIVED_NOTES.census?.detail).toContain('Census counts beds held')
  expect(DERIVED_NOTES.census?.detail).toContain('not revenue per paying resident')
 })
})
