/**
 * COL-374 / DEC-2026-09-22-01: which Stand Up bed category an open bed belongs
 * to is decided by who is in the room right now, never by a label stored on
 * the bed. A room is a "female room" only while a woman holds (or is reserved
 * for) one of its other beds. "It was a female room because that's who was in
 * there last" is exactly the error this removes.
 *
 * Rules, as the company settled them:
 *   - A bed is held by a resident who lives here (active, hospital_hold, loa;
 *     the same set as STAND_UP_ROSTER_CENSUS_STATUSES) — not open.
 *   - A bed reserved for someone who has not moved in (bed status 'hold', or a
 *     pending_admission resident assigned to it) is not open. DEC-2026-09-21-03.
 *   - A bed out of service (maintenance, offline, temporarily blocked) IS open.
 *     DEC-2026-09-21-03. It is also counted in `out_of_service`, so the form can
 *     say how many of the open beds cannot be sold today.
 *   - An open bed in a private room is private.
 *   - An open bed in a semi-private or shared room is flexible when nobody holds
 *     or is reserved for any other bed in the room; female when every such
 *     roommate is a woman; male when every such roommate is a man.
 *   - Anything else (roommate's sex not recorded as male or female, a reserved
 *     bed with no resident attached, mixed roommates) is `unclassified`: Haven
 *     will not guess, and the administrator places those beds.
 *
 * The SQL mirror is public.stand_up_roster_beds (migration 555). The two share
 * one fixture: bed-classification.test.ts and
 * supabase/tests/review_stand_up_roster_beds.sql assert the same counts.
 */

export const BED_HOLDING_RESIDENT_STATUSES = ['active', 'hospital_hold', 'loa'] as const
export const BED_RESERVING_RESIDENT_STATUSES = ['pending_admission'] as const
export const OUT_OF_SERVICE_BED_STATUSES = ['maintenance', 'offline'] as const

export type ClassifierBed = {
  id: string
  room_id: string
  status: string | null
  current_resident_id: string | null
  is_temporarily_blocked?: boolean | null
}
export type ClassifierRoom = { id: string; room_type: string | null }
export type ClassifierResident = { id: string; bed_id: string | null; status: string | null; gender: string | null }

export type OpenBedCounts = {
  sp_female: number
  sp_male: number
  sp_flexible: number
  private: number
  /** Open semi-private beds Haven cannot place; the administrator decides. */
  unclassified: number
  /** Open beds (of any category) that are in maintenance, offline or blocked. */
  out_of_service: number
  /** Beds reserved for someone who has not moved in. Not open. */
  reserved: number
  /** Beds recorded in Haven for the facility. Zero means no bed roster. */
  beds: number
}

const holds = (status: string | null) => (BED_HOLDING_RESIDENT_STATUSES as readonly string[]).includes(status ?? '')
const reserves = (status: string | null) => (BED_RESERVING_RESIDENT_STATUSES as readonly string[]).includes(status ?? '')

type BedState = { bed: ClassifierBed; held: boolean; reserved: boolean; sex: 'female' | 'male' | 'unknown' | null }

export type BedCategory = 'private' | 'sp_female' | 'sp_male' | 'sp_flexible' | 'unclassified'
/** One bed's place in the Stand Up, by the same rule as the counts. */
export type ClassifiedBed =
  | { state: 'held' }
  | { state: 'reserved' }
  | { state: 'open'; category: BedCategory; outOfService: boolean }

/** Every bed in a known room, keyed by bed id. Beds whose room Haven does not hold are left out. */
export function classifyBeds(beds: ClassifierBed[], rooms: ClassifierRoom[], residents: ClassifierResident[]): Map<string, ClassifiedBed> {
  const roomType = new Map(rooms.map(room => [room.id, room.room_type]))
  const byId = new Map(residents.map(resident => [resident.id, resident]))
  // Only beds that sit in a known room are counted; a bed without a room cannot be classified or sold.
  const known = beds.filter(bed => roomType.has(bed.room_id))
  const states: BedState[] = known.map(bed => {
    const occupants = residents.filter(resident => resident.bed_id === bed.id)
    const pointed = bed.current_resident_id ? byId.get(bed.current_resident_id) : undefined
    if (pointed && !occupants.includes(pointed)) occupants.push(pointed)
    const holders = occupants.filter(resident => holds(resident.status))
    // A pointer to a resident Haven cannot see still means someone is in the bed.
    const hiddenHolder = !!bed.current_resident_id && !pointed
    const held = holders.length > 0 || hiddenHolder
    const reservedFor = held ? [] : occupants.filter(resident => reserves(resident.status))
    const reserved = !held && (bed.status === 'hold' || reservedFor.length > 0)
    const people = held ? holders : reservedFor
    // Multiple reservations can point at one bed. Every person must agree;
    // choosing the first record would invent a category for mixed/unknown sex.
    const sex = hiddenHolder ? 'unknown' : people.length > 0
      ? people.every(person => person.gender === 'female') ? 'female'
        : people.every(person => person.gender === 'male') ? 'male' : 'unknown'
      : held || reserved ? 'unknown' : null
    return { bed, held, reserved, sex }
  })
  const result = new Map<string, ClassifiedBed>()
  for (const state of states) {
    if (state.held) { result.set(state.bed.id, { state: 'held' }); continue }
    if (state.reserved) { result.set(state.bed.id, { state: 'reserved' }); continue }
    const outOfService = (OUT_OF_SERVICE_BED_STATUSES as readonly string[]).includes(state.bed.status ?? '') || !!state.bed.is_temporarily_blocked
    let category: BedCategory
    if (roomType.get(state.bed.room_id) === 'private') category = 'private'
    else {
      const roommates = states.filter(other => other.bed.room_id === state.bed.room_id && other.bed.id !== state.bed.id && other.sex !== null)
      if (roommates.length === 0) category = 'sp_flexible'
      else if (roommates.every(other => other.sex === 'female')) category = 'sp_female'
      else if (roommates.every(other => other.sex === 'male')) category = 'sp_male'
      else category = 'unclassified'
    }
    result.set(state.bed.id, { state: 'open', category, outOfService })
  }
  return result
}

export function classifyOpenBeds(beds: ClassifierBed[], rooms: ClassifierRoom[], residents: ClassifierResident[]): OpenBedCounts {
  const counts: OpenBedCounts = { sp_female: 0, sp_male: 0, sp_flexible: 0, private: 0, unclassified: 0, out_of_service: 0, reserved: 0, beds: 0 }
  for (const bed of classifyBeds(beds, rooms, residents).values()) {
    counts.beds++
    if (bed.state === 'reserved') counts.reserved++
    if (bed.state !== 'open') continue
    if (bed.outOfService) counts.out_of_service++
    counts[bed.category]++
  }
  return counts
}

/** Plain words for a bed's category, for the facility page. */
export const BED_CATEGORY_LABELS: Record<BedCategory, string> = {
  private: 'Private',
  sp_female: 'Semi-private — women',
  sp_male: 'Semi-private — men',
  sp_flexible: 'Semi-private — either',
  unclassified: 'Cannot place — roommate’s sex not recorded',
}

/** Total open beds as the Stand Up adds them: the four categories plus beds Haven could not place. */
export const totalOpenBeds = (counts: OpenBedCounts): number =>
  counts.sp_female + counts.sp_male + counts.sp_flexible + counts.private + counts.unclassified
