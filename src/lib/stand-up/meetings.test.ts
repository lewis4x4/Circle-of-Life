import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { THURSDAY_KEYS, meetingReportState, meetingWindowLine, mondayComparison, parseThursdayField, thursdayDisplay, wallClock, type MeetingReport, type MeetingScheduleEntry } from './meetings'

const schedule: MeetingScheduleEntry[] = [
  { meeting_day: 'monday', weekday: 1, entry_due_local: '08:45', call_local: '09:15', time_zone: 'America/New_York', facility_override: false },
  { meeting_day: 'thursday', weekday: 4, entry_due_local: '08:45', call_local: '09:15', time_zone: 'America/New_York', facility_override: false },
]
const baseline = { revision_id: 'm', submitted_at: '2026-09-21T12:40:00Z', values: { current_ar_cents: 11000000, current_total_census: 38, hospital_and_rehab_total: 1 } }

describe('meeting schedule wording comes from the schedule, not from code', () => {
  it('words Thursday from the rows the server returned', () => {
    expect(meetingWindowLine(schedule, 'thursday')).toBe('Opens at Monday’s call · Due Thursday 8:45 a.m. · Call 9:15 a.m. Eastern')
  })
  it('follows a changed schedule', () => {
    const moved: MeetingScheduleEntry[] = [schedule[0], { ...schedule[1], weekday: 5, entry_due_local: '13:30', call_local: '14:00' }]
    expect(meetingWindowLine(moved, 'thursday')).toBe('Opens at Monday’s call · Due Friday 1:30 p.m. · Call 2:00 p.m. Eastern')
    expect(meetingWindowLine([schedule[0]], 'thursday')).toBeNull()
  })
  it('reads wall-clock times', () => {
    expect(wallClock('00:05')).toBe('12:05 a.m.')
    expect(wallClock('12:00')).toBe('12:00 p.m.')
  })
})

describe('Thursday against what was submitted on Monday', () => {
  it('states the change for figures Monday reports', () => {
    expect(mondayComparison('current_total_census', 36, baseline)).toEqual({ monday: '38', change: '−2' })
    expect(mondayComparison('current_ar_cents', 11710800, baseline)).toEqual({ monday: '$110,000.00', change: '+$7,108.00' })
    expect(mondayComparison('hospital_and_rehab_total', 1, baseline)).toEqual({ monday: '1', change: 'No change' })
  })
  it('never invents a baseline', () => {
    expect(mondayComparison('departures_since_monday', 2, baseline)).toEqual({ monday: 'Not on Monday’s report', change: null })
    expect(mondayComparison('current_total_census', 36, null)).toEqual({ monday: 'Monday not submitted', change: null })
    expect(mondayComparison('current_total_census', null, baseline)).toEqual({ monday: '38', change: null })
  })
  it('parses dollars and counts; blank is not zero', () => {
    expect(parseThursdayField('current_ar_cents', '$117,108.00')).toBe(11710800)
    expect(parseThursdayField('current_total_census', ' ')).toBeNull()
    expect(() => parseThursdayField('current_total_census', '3.5')).toThrow('whole number')
    expect(thursdayDisplay('current_total_census', null)).toBe('Not provided')
  })
  it('reads an empty report as not started', () => {
    const empty = { values: Object.fromEntries(THURSDAY_KEYS.map(key => [key, null])), status: 'draft' } as unknown as MeetingReport
    expect(meetingReportState(empty)).toBe('Not started')
    expect(meetingReportState(undefined)).toBe('Not started')
  })
})

const root = process.cwd()
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap(name => {
    const rel = path.join(dir, name)
    return statSync(path.join(root, rel)).isDirectory() ? files(rel) : [rel]
  })
}

describe('Thursday is Haven only (Brian, 2026-09-24)', () => {
  it('no publisher, history archive or Google sync reads a meeting other than Monday', () => {
    const publishers = ['supabase/functions/stand-up-publisher', 'supabase/functions/stand-up-history-publisher', 'supabase/functions/stand-up-google', 'scripts/stand-up'].flatMap(files)
    expect(publishers.length).toBeGreaterThan(5)
    for (const file of publishers) expect(read(file), file).not.toMatch(/meeting_day|stand_up_meeting_(reports|revisions|schedule)|thursday/i)
  })
  it('the client and the server hold the same Thursday figures', () => {
    // The latest migration that defines the Thursday figure set wins (517, then COL-755's 521).
    const migration = files('supabase/migrations').filter(file => /FUNCTION haven\.stand_up_meeting_keys/.test(read(file))).sort().at(-1)!
    const keys = read(migration).match(/WHEN 'thursday' THEN ARRAY\[([^\]]+)\]/)![1].match(/'([a-z_]+)'/g)!.map(key => key.slice(1, -1))
    expect(keys).toEqual(THURSDAY_KEYS)
  })
})
