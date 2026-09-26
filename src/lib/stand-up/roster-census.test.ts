import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BED_ROSTER_KEYS, NO_BED_ROSTER_TEXT, formatBedSummary, formatRosterBeds, hasBedRoster, hasRosterFor, NO_ROSTER_TEXT, ROSTER_FIELD_KEYS, STAND_UP_ROSTER_CENSUS_STATUSES, expectedSource, formatRosterCensusBreakdown, formatRosterHospital, hasRoster, isOverrideReason, recordedConfirmationLine, rosterAsOfLine, rosterSourceSuffix, rosterSuggestion, selectHospitalSuggestion, type RosterCensus } from './roster-census'

const roster: RosterCensus = { facility_id: 'a', in_house_count: 32, hospital_hold_count: 1, loa_count: 1, roster_census_count: 34, resident_count_in_haven: 40, roster_as_of: '2026-09-16T18:14:00Z' }
const empty: RosterCensus = { facility_id: 'b', in_house_count: 0, hospital_hold_count: 0, loa_count: 0, roster_census_count: 0, resident_count_in_haven: 0, roster_as_of: null }

describe('roster census suggestion', () => {
  it('keeps one status set, mirrored by the SQL function and the billable view', () => {
    expect([...STAND_UP_ROSTER_CENSUS_STATUSES]).toEqual(['active', 'hospital_hold', 'loa'])
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/404_stand_up_roster_census.sql'), 'utf8')
    expect(migration).toContain(`status IN('${STAND_UP_ROSTER_CENSUS_STATUSES.join("','")}')`)
    // COL-750: the as-of roster (effective dates) counts the same set.
    const asOf = readFileSync(resolve(process.cwd(), 'supabase/migrations/504_resident_movement_effective_dates.sql'), 'utf8')
    expect(asOf).toContain(`status IN('${STAND_UP_ROSTER_CENSUS_STATUSES.join("','")}')`)
    const billable = readFileSync(resolve(process.cwd(), 'supabase/migrations/217_col_v2_status_and_medicaid_provider_foundation.sql'), 'utf8')
    expect(billable).toContain(`r.status IN ('${STAND_UP_ROSTER_CENSUS_STATUSES.join("', '")}') THEN true`)
    expect([...ROSTER_FIELD_KEYS]).toEqual(['current_total_census', 'hospital_and_rehab_total', 'sp_female_beds_open', 'sp_male_beds_open', 'sp_flexible_beds_open', 'private_beds_open'])
    const beds = readFileSync(resolve(process.cwd(), 'supabase/migrations/555_stand_up_beds_from_rooms.sql'), 'utf8')
    expect(beds).toContain(`ARRAY['${ROSTER_FIELD_KEYS.join("','")}']::text[]`)
  })
  it('always shows the total with its components', () => {
    expect(formatRosterCensusBreakdown(roster)).toBe('Roster: 34 (32 in house, 1 hospital or rehab, 1 leave)')
    expect(formatRosterHospital(roster)).toBe('Roster: 1 at hospital or rehab')
  })
  it('shows hospital and rehab apart beside the one Monday figure (COL-755)', () => {
    expect(formatRosterHospital({ ...roster, hospital_hold_count: 3, hospital_count: 1, rehab_count: 1, bed_hold_type_not_recorded_count: 1 }))
      .toBe('Roster: 3 at hospital or rehab (1 hospital, 1 rehab, 1 type not recorded)')
    expect(formatRosterHospital({ ...roster, hospital_hold_count: 2, hospital_count: 0, rehab_count: 2, bed_hold_type_not_recorded_count: 0 }))
      .toBe('Roster: 2 at hospital or rehab (0 hospital, 2 rehab)')
    // Monday's suggested figure stays the one total.
    expect(rosterSuggestion({ ...roster, hospital_hold_count: 3, hospital_count: 1, rehab_count: 1 }, 'hospital_and_rehab_total')).toBe(3)
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
  it('takes override reasons from the facility setting, not a list in code (COL-555)', () => {
    const options = [{ key: 'awaiting_paperwork', label: 'Paperwork not back from the hospital' }, { key: 'other', label: 'Other' }]
    expect(isOverrideReason('awaiting_paperwork', options)).toBe(true)
    expect(isOverrideReason('roster_not_current', options)).toBe(false)
    expect(isOverrideReason('other', null)).toBe(false)
    const source = readFileSync(resolve(process.cwd(), 'src/lib/stand-up/roster-census.ts'), 'utf8')
    expect(source).not.toMatch(/OVERRIDE_REASONS\s*=/)
    expect(source).not.toContain("'Roster not updated yet'")
  })
  it('says something only for an override, and shows a past confirmation as recorded', () => {
    const confirmed = { source: 'roster_confirmed' as const, suggested: 34, confirmed: 34, override_reason: null, roster_as_of: roster.roster_as_of, confirmed_at: '2026-09-14T12:00:00Z' }
    const overridden = { ...confirmed, source: 'overridden' as const, confirmed: 35, override_reason: 'roster_not_current', override_reason_label: 'Roster not updated yet' }
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

describe('bed figures from Haven rooms (COL-374)', () => {
  const beds: RosterCensus = { ...roster, sp_female_open: 2, sp_male_open: 1, sp_flexible_open: 6, private_open: 2, unclassified_open: 2, out_of_service_open: 2, reserved_count: 2, bed_count_in_haven: 19, beds_as_of: '2026-09-22T13:05:00Z' }
  it('suggests each bed figure from its own count', () => {
    expect(rosterSuggestion(beds, 'sp_female_beds_open')).toBe(2)
    expect(rosterSuggestion(beds, 'sp_male_beds_open')).toBe(1)
    expect(rosterSuggestion(beds, 'sp_flexible_beds_open')).toBe(6)
    expect(rosterSuggestion(beds, 'private_beds_open')).toBe(2)
    expect(formatRosterBeds(beds, 'sp_flexible_beds_open')).toBe("Haven's rooms: 6 flexible open")
  })
  it('says once what Haven could not place, what is out of service and what is reserved', () => {
    expect(formatBedSummary(beds)).toBe("Haven's rooms show 13 open beds; 2 Haven cannot place because a roommate's sex is not recorded — count them yourself; 2 of the open beds are out of service; 2 reserved, not open.")
    expect(formatBedSummary({ ...beds, unclassified_open: 0, out_of_service_open: 0, reserved_count: 0, sp_female_open: 0, sp_male_open: 0, sp_flexible_open: 1, private_open: 0 })).toBe("Haven's rooms show 1 open bed.")
  })
  it('keeps census and bed suggestions independent', () => {
    // Residents but no beds recorded: census is suggested, beds are typed.
    expect(hasRosterFor(roster, 'current_total_census')).toBe(true)
    expect(hasBedRoster(roster)).toBe(false)
    for (const key of BED_ROSTER_KEYS) {
      expect(rosterSuggestion(roster, key)).toBeNull()
      expect(expectedSource(roster, key, 3)).toBe('entered_no_roster')
    }
    expect(NO_BED_ROSTER_TEXT).toBe('No rooms and beds in Haven for this facility')
  })
  it('asks for a reason when a typed bed figure differs from the rooms', () => {
    expect(expectedSource(beds, 'sp_female_beds_open', 2)).toBe('roster_confirmed')
    expect(expectedSource(beds, 'sp_female_beds_open', 3)).toBe('overridden')
  })
  it('dates the bed suggestion by the last bed change', () => {
    expect(rosterAsOfLine(beds, 'private_beds_open')).toBe('Beds last changed Sep 22, 9:05 a.m.')
    expect(rosterAsOfLine({ ...beds, beds_as_of: null }, 'private_beds_open')).toBe('Beds have no recorded change')
    expect(rosterAsOfLine(beds, 'current_total_census')).toBe('Roster last changed Sep 16, 2:14 p.m.')
  })
})
