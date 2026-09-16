import { describe, expect, it } from 'vitest'
import { DERIVED_NOTES, FIELD_DEFINITIONS, PENDING_DEFINITIONS, REPORTING_QUALIFICATION, SECTION_NOTES, UNRESOLVED_DEFINITIONS, fieldHelp, pendingDefinition, sectionUnresolvedCount } from './field-definitions'
import { METRIC_KEYS, METRICS } from './model'

describe('Stand Up field definitions', () => {
 it('defines every figure and nothing that is not a figure', () => {
  expect(Object.keys(FIELD_DEFINITIONS).sort()).toEqual([...METRIC_KEYS].sort())
  expect(METRIC_KEYS.every(key => fieldHelp(key).length > 0)).toBe(true)
 })
 it('keeps unresolved reporting questions out of ordinary field help', () => {
  // An open counting rule is a reporting question for the company, not an instruction
  // for the administrator, so it never reaches the sentence shown beside a figure.
  for (const key of METRIC_KEYS) expect(FIELD_DEFINITIONS[key]).not.toMatch(/pending|not settled|unresolved|tbd/i)
  // Nor does a note about how an earlier workbook happened to word a label.
  for (const key of METRIC_KEYS) expect(FIELD_DEFINITIONS[key]).not.toMatch(/carried-over|despite the|wording/i)
  for (const text of Object.values(SECTION_NOTES)) expect(text).not.toMatch(/pending|not settled/i)
 })
 it('holds exactly the fourteen counting rules the reporting contract records as open', () => {
  // Source: Haven Drive Discovery 2026-09-10/STAND-UP-CONTRACT.md, "Observed 2026 mapping".
  // Only Admissions Expected and Tours Expected carry no pending note there.
  expect(UNRESOLVED_DEFINITIONS).toEqual(METRICS.map(metric => metric.key).filter(key => key !== 'admissions_expected' && key !== 'tours_expected'))
  expect(UNRESOLVED_DEFINITIONS).toHaveLength(14)
  expect(Object.keys(PENDING_DEFINITIONS).sort()).toEqual([...UNRESOLVED_DEFINITIONS].sort())
  expect(pendingDefinition('admissions_expected')).toBeNull()
  expect(pendingDefinition('callouts_last_week')).toBe('Whether one callout is an employee, a shift or an occurrence.')
  expect(sectionUnresolvedCount('beds')).toBe(4)
  expect(sectionUnresolvedCount('marketing')).toBe(2)
 })
 it('states the report-wide qualification once, including what the recorded time is', () => {
  expect(REPORTING_QUALIFICATION).toContain('no agreed as-of point')
  expect(REPORTING_QUALIFICATION).toContain('not a separate observation time')
  expect(REPORTING_QUALIFICATION).toContain('provisional')
 })
 it('names the derived ratio for what it is rather than an average of resident charges', () => {
  expect(DERIVED_NOTES.census?.term).toBe('Monthly rent roll per census resident')
  expect(DERIVED_NOTES.census?.detail).toContain('Not a checked resident-level average')
 })
})
