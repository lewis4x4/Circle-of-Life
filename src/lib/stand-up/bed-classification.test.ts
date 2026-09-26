import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BED_HOLDING_RESIDENT_STATUSES, classifyOpenBeds, totalOpenBeds, type ClassifierBed, type ClassifierResident, type ClassifierRoom } from './bed-classification'
import { STAND_UP_ROSTER_CENSUS_STATUSES } from './roster-census'

/**
 * The shared fixture. supabase/tests/review_stand_up_roster_beds.sql builds the
 * same rooms, beds and residents and asserts the same counts from
 * public.stand_up_roster_beds. Change one, change both.
 *
 *   P1 private, empty                         -> private (open)
 *   P2 private, maintenance                   -> private (open, out of service)
 *   P3 private, woman in it                   -> held
 *   S1 semi, both beds empty                  -> 2 flexible
 *   S2 semi, woman in A                       -> B female
 *   S3 semi, man in A (at hospital)           -> B male
 *   S4 semi, A reserved (bed status 'hold')   -> A reserved; B unclassified (reserved for someone unnamed)
 *   S5 semi, A pending_admission woman        -> A reserved; B female
 *   S6 semi, A resident, sex not male/female -> B unclassified
 *   S7 semi, A discharged man (bed_id cleared)-> 2 flexible (last occupant is not a rule)
 *   S8 semi, A offline, B empty               -> 2 flexible, 1 out of service
 */
function fixture() {
  const rooms: ClassifierRoom[] = [
    ...['P1', 'P2', 'P3'].map(id => ({ id, room_type: 'private' })),
    ...['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map(id => ({ id, room_type: 'semi_private' })),
  ]
  const bed = (id: string, room_id: string, status = 'available', current_resident_id: string | null = null): ClassifierBed => ({ id, room_id, status, current_resident_id })
  const beds: ClassifierBed[] = [
    bed('P1', 'P1'), bed('P2', 'P2', 'maintenance'), bed('P3', 'P3', 'occupied', 'r-p3'),
    bed('S1A', 'S1'), bed('S1B', 'S1'),
    bed('S2A', 'S2', 'occupied', 'r-s2'), bed('S2B', 'S2'),
    bed('S3A', 'S3', 'occupied', 'r-s3'), bed('S3B', 'S3'),
    bed('S4A', 'S4', 'hold'), bed('S4B', 'S4'),
    bed('S5A', 'S5'), bed('S5B', 'S5'),
    bed('S6A', 'S6', 'occupied', 'r-s6'), bed('S6B', 'S6'),
    bed('S7A', 'S7'), bed('S7B', 'S7'),
    bed('S8A', 'S8', 'offline'), bed('S8B', 'S8'),
    bed('NOROOM', 'missing-room'),
  ]
  const residents: ClassifierResident[] = [
    { id: 'r-p3', bed_id: 'P3', status: 'active', gender: 'female' },
    { id: 'r-s2', bed_id: 'S2A', status: 'active', gender: 'female' },
    { id: 'r-s3', bed_id: 'S3A', status: 'hospital_hold', gender: 'male' },
    { id: 'r-s5', bed_id: 'S5A', status: 'pending_admission', gender: 'female' },
    { id: 'r-s6', bed_id: 'S6A', status: 'active', gender: 'prefer_not_to_say' },
    { id: 'r-s7', bed_id: null, status: 'discharged', gender: 'male' },
  ]
  return { rooms, beds, residents }
}

describe('Stand Up open-bed classification (COL-374)', () => {
  it('classifies by who is in the room now', () => {
    const { rooms, beds, residents } = fixture()
    expect(classifyOpenBeds(beds, rooms, residents)).toEqual({
      private: 2, sp_flexible: 6, sp_female: 2, sp_male: 1, unclassified: 2, out_of_service: 2, reserved: 2, beds: 19,
    })
  })
  it('adds every open bed exactly once into the total', () => {
    const { rooms, beds, residents } = fixture()
    // 19 beds in known rooms: 4 held (P3, S2A, S3A, S6A), 2 reserved (S4A, S5A), 13 open.
    expect(totalOpenBeds(classifyOpenBeds(beds, rooms, residents))).toBe(13)
  })
  it('never keeps a room female because of who was in it last', () => {
    const rooms = [{ id: 'R', room_type: 'semi_private' }]
    const beds = [{ id: 'A', room_id: 'R', status: 'available', current_resident_id: null }, { id: 'B', room_id: 'R', status: 'available', current_resident_id: null }]
    const residents = [{ id: 'gone', bed_id: null, status: 'discharged', gender: 'female' }]
    expect(classifyOpenBeds(beds, rooms, residents).sp_flexible).toBe(2)
    expect(classifyOpenBeds(beds, rooms, residents).sp_female).toBe(0)
  })
  it('treats a bed pointer to an unseen resident as occupied, not open', () => {
    const rooms = [{ id: 'R', room_type: 'semi_private' }]
    const beds = [{ id: 'A', room_id: 'R', status: 'occupied', current_resident_id: 'hidden' }, { id: 'B', room_id: 'R', status: 'available', current_resident_id: null }]
    expect(classifyOpenBeds(beds, rooms, [])).toMatchObject({ unclassified: 1, sp_flexible: 0 })
  })
  it('uses the census status set for who holds a bed', () => {
    expect([...BED_HOLDING_RESIDENT_STATUSES]).toEqual([...STAND_UP_ROSTER_CENSUS_STATUSES])
  })
  it('ignores a visible stale pointer after discharge while retaining an unknown pointer', () => {
    const beds = [{ id: 'a', room_id: 'r', status: 'available', current_resident_id: 'departed' }, { id: 'b', room_id: 'r', status: 'available', current_resident_id: null }];
    const rooms = [{ id: 'r', room_type: 'semi_private' }];
    const residents = [{ id: 'departed', bed_id: null, status: 'discharged', gender: 'female' }];
    expect(classifyOpenBeds(beds, rooms, residents).sp_flexible).toBe(2);
    expect(classifyOpenBeds(beds, rooms, []).unclassified).toBe(1);
  })
  it('leaves mixed and unknown reservations unclassified regardless of record order', () => {
    const beds = [{ id: 'a', room_id: 'r', status: 'available', current_resident_id: null }, { id: 'b', room_id: 'r', status: 'available', current_resident_id: null }];
    const rooms = [{ id: 'r', room_type: 'semi_private' }];
    const residents = [{ id: 'one', bed_id: 'a', status: 'pending_admission', gender: 'female' }, { id: 'two', bed_id: 'a', status: 'pending_admission', gender: 'male' }];
    for (const people of [residents, [...residents].reverse(), [residents[0], { ...residents[1], gender: null }]]) {
      expect(classifyOpenBeds(beds, rooms, people)).toMatchObject({ reserved: 1, unclassified: 1, sp_female: 0, sp_male: 0 });
    }
  })
  it('is mirrored by the SQL function the Stand Up command reads', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/555_stand_up_beds_from_rooms.sql'), 'utf8')
    expect(migration).toContain('CREATE FUNCTION public.stand_up_roster_beds(')
    expect(migration).toContain(`status IN('${BED_HOLDING_RESIDENT_STATUSES.join("','")}')`)
    expect(migration).toContain(`status IN('maintenance','offline')`)
  })
})

describe('per-bed classification', () => {
  it('gives each bed in a known room exactly one state, matching the counts', async () => {
    const { classifyBeds } = await import('./bed-classification')
    const rooms = [{ id: 'S', room_type: 'semi_private' }, { id: 'P', room_type: 'private' }]
    const beds = [
      { id: 'SA', room_id: 'S', status: 'occupied', current_resident_id: 'w' },
      { id: 'SB', room_id: 'S', status: 'available', current_resident_id: null },
      { id: 'PA', room_id: 'P', status: 'offline', current_resident_id: null },
      { id: 'X', room_id: 'nowhere', status: 'available', current_resident_id: null },
    ]
    const residents = [{ id: 'w', bed_id: 'SA', status: 'active', gender: 'female' }]
    const map = classifyBeds(beds, rooms, residents)
    expect([...map.keys()]).toEqual(['SA', 'SB', 'PA'])
    expect(map.get('SA')).toEqual({ state: 'held' })
    expect(map.get('SB')).toEqual({ state: 'open', category: 'sp_female', outOfService: false })
    expect(map.get('PA')).toEqual({ state: 'open', category: 'private', outOfService: true })
  })
})
