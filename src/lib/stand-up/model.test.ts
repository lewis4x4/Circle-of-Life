import { describe, expect, it } from 'vitest'
import { derivedValues, emptyValues, reportingWeek, validateValues } from './model'
describe('Stand Up reporting contract', () => {
 it('opens upcoming Monday on Eastern Sunday, including DST transition', () => {
  expect(reportingWeek(new Date('2026-09-13T04:00:00Z'))).toBe('2026-09-14')
  expect(reportingWeek(new Date('2026-09-13T03:59:59Z'))).toBe('2026-09-07')
  expect(reportingWeek(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-02')
 })
 it('keeps blanks distinct from zero and rejects implicit coercion and unknown metrics', () => {
  expect(validateValues(emptyValues())).toEqual([])
  expect(validateValues({ ...emptyValues(), current_total_census: '0' })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), extra: 0 })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), monthly_rent_roll_cents: 0.5 })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), overtime_reported: 2.5 })).toEqual([])
 })
 it('does not fabricate averages or total beds from incomplete values', () => {
  expect(derivedValues(emptyValues())).toEqual({ average_rent_cents: null, total_beds_open: null, completed_fields: 0 })
  expect(derivedValues({ ...emptyValues(), monthly_rent_roll_cents: 120001, current_total_census: 3 }).average_rent_cents).toBe(40000)
  expect(derivedValues({ ...emptyValues(), monthly_rent_roll_cents: 120001, current_total_census: 0 }).average_rent_cents).toBeNull()
 })
})
