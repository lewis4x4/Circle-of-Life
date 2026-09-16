import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NO_ROSTER_TEXT, OVERRIDE_REASONS, ROSTER_FIELD_KEYS, STAND_UP_ROSTER_CENSUS_STATUSES, expectedSource, formatRosterCensusBreakdown, formatRosterHospital, hasRoster, isOverrideReason, recordedConfirmationLine, rosterAsOfLine, rosterSourceSuffix, rosterSuggestion, selectHospitalSuggestion, type RosterCensus } from './roster-census'

const roster: RosterCensus = { facility_id: 'a', in_house_count: 32, hospital_hold_count: 1, loa_count: 1, roster_census_count: 34, resident_count_in_haven: 40, roster_as_of: '2026-09-16T18:14:00Z' }
const empty: RosterCensus = { facility_id: 'b', in_house_count: 0, hospital_hold_count: 0, loa_count: 0, roster_census_count: 0, resident_count_in_haven: 0, roster_as_of: null }

describe('roster census suggestion', () => {
  it('keeps one status set, mirrored by the SQL function and the billable view', () => {
    expect([...STAND_UP_ROSTER_CENSUS_STATUSES]).toEqual(['active', 'hospital_hold', 'loa'])
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/404_stand_up_roster_census.sql'), 'utf8')
    expect(migration).toContain(`status IN('${STAND_UP_ROSTER_CENSUS_STATUSES.join("','")}')`)
    const billable = readFileSync(resolve(process.cwd(), 'supabase/migrations/217_col_v2_status_and_medicaid_provider_foundation.sql'), 'utf8')
    expect(billable).toContain(`r.status IN ('${STAND_UP_ROSTER_CENSUS_STATUSES.join("', '")}') THEN true`)
    expect([...ROSTER_FIELD_KEYS]).toEqual(['current_total_census', 'hospital_and_rehab_total'])
  })
  it('always shows the total with its components', () => {
    expect(formatRosterCensusBreakdown(roster)).toBe('Roster: 34 (32 in house, 1 hospital, 1 leave)')
    expect(formatRosterHospital(roster)).toBe('Roster: 1 at hospital')
  })
  it('suggests hospital as a point in time count and census as the three held statuses', () => {
    expect(selectHospitalSuggestion(roster)).toBe(1)
    expect(rosterSuggestion(roster, 'current_total_census')).toBe(34)
    expect(rosterSuggestion(roster, 'hospital_and_rehab_total')).toBe(1)
  })
  it('gives no suggestion when the facility has no residents in Haven', () => {
    expect(hasRoster(empty)).toBe(false)
    expect(hasRoster(undefined)).toBe(false)
    expect(selectHospitalSuggestion(empty)).toBeNull()
    expect(rosterSuggestion(empty, 'current_total_census')).toBeNull()
    expect(NO_ROSTER_TEXT).toBe('No roster in Haven for this facility')
  })
  it('names the roster as-of as neutral Eastern text without a threshold', () => {
    expect(rosterAsOfLine(roster)).toBe('Roster last changed Sep 16, 2:14 p.m.')
    expect(rosterAsOfLine({ ...roster, roster_as_of: null })).toBe('Roster has no recorded status change')
  })
  it('predicts the source the server will record so the form can ask for a reason first', () => {
    expect(expectedSource(roster, 'current_total_census', 34)).toBe('roster_confirmed')
    expect(expectedSource(roster, 'current_total_census', 35)).toBe('overridden')
    expect(expectedSource(roster, 'hospital_and_rehab_total', 1)).toBe('roster_confirmed')
    expect(expectedSource(empty, 'current_total_census', 12)).toBe('entered_no_roster')
    expect(expectedSource(roster, 'current_total_census', null)).toBeNull()
  })
  it('keeps override reasons to a fixed list', () => {
    expect(OVERRIDE_REASONS.map(reason => reason.key)).toEqual(['roster_not_current', 'change_not_entered', 'different_definition', 'other'])
    expect(isOverrideReason('other')).toBe(true)
    expect(isOverrideReason('because')).toBe(false)
  })
  it('says something only for an override, and shows a past confirmation as recorded', () => {
    const confirmed = { source: 'roster_confirmed' as const, suggested: 34, confirmed: 34, override_reason: null, roster_as_of: roster.roster_as_of, confirmed_at: '2026-09-14T12:00:00Z' }
    const overridden = { ...confirmed, source: 'overridden' as const, confirmed: 35, override_reason: 'roster_not_current' as const }
    const typed = { ...confirmed, source: 'entered_no_roster' as const, suggested: null, confirmed: 12 }
    expect(rosterSourceSuffix(confirmed)).toBeNull()
    expect(rosterSourceSuffix(typed)).toBeNull()
    expect(rosterSourceSuffix(overridden)).toBe('override: Roster not updated yet')
    expect(recordedConfirmationLine(confirmed)).toBe('Confirmed from the roster (34)')
    expect(recordedConfirmationLine(overridden)).toBe('Roster suggested 34 · override: Roster not updated yet')
    expect(recordedConfirmationLine(typed)).toBe('Entered without a Haven roster')
    expect(recordedConfirmationLine(undefined)).toBeNull()
  })
})
