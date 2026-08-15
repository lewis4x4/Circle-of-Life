/**
 * Quiet Operator copy for med-tech shift-current resident, medication, and room labels.
 * Missing joins and blank fields name real gaps — never "Unknown" or a silent dash.
 */

export const SHIFT_CURRENT_NO_RESIDENT_COPY = "No resident posted";
export const SHIFT_CURRENT_NO_NAME_COPY = "No name posted";
export const SHIFT_CURRENT_NO_MEDICATION_COPY = "No medication posted";
export const SHIFT_CURRENT_NO_ROOM_COPY = "No room posted";

const EM_DASH = "—";
const HYPHEN = "-";

function isBlankOrPlaceholder(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH || trimmed === HYPHEN;
}

export type ShiftCurrentResidentFields = {
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
};

export type ShiftCurrentMedicationFields = {
  medication_name: string | null;
  strength: string | null;
};

function shiftCurrentFirstName(resident: ShiftCurrentResidentFields): string {
  const preferred = resident.preferred_name?.trim();
  if (preferred && !isBlankOrPlaceholder(preferred)) return preferred;
  return resident.first_name?.trim() ?? "";
}

function shiftCurrentResidentNameParts(
  resident: ShiftCurrentResidentFields,
): { lastName: string; firstName: string } | null {
  const lastName = resident.last_name?.trim() ?? "";
  const firstName = shiftCurrentFirstName(resident);
  if (isBlankOrPlaceholder(lastName) && isBlankOrPlaceholder(firstName)) return null;
  if (isBlankOrPlaceholder(lastName) || isBlankOrPlaceholder(firstName)) return null;
  return { lastName, firstName };
}

/** Full resident label for med passes — "Last, First" when posted. */
export function formatShiftCurrentResidentName(
  resident: ShiftCurrentResidentFields | null | undefined,
): string {
  if (!resident) return SHIFT_CURRENT_NO_RESIDENT_COPY;
  const parts = shiftCurrentResidentNameParts(resident);
  if (!parts) return SHIFT_CURRENT_NO_NAME_COPY;
  return `${parts.lastName}, ${parts.firstName}`;
}

/** Compact resident label for the rail — "Last, F." when posted. */
export function formatShiftCurrentResidentCompactName(
  resident: ShiftCurrentResidentFields | null | undefined,
): string {
  if (!resident) return SHIFT_CURRENT_NO_RESIDENT_COPY;
  const parts = shiftCurrentResidentNameParts(resident);
  if (!parts) return SHIFT_CURRENT_NO_NAME_COPY;
  return `${parts.lastName}, ${parts.firstName.charAt(0)}.`;
}

/** Medication label on a pass row when the join or fields are unset. */
export function formatShiftCurrentMedicationLabel(
  medication: ShiftCurrentMedicationFields | null | undefined,
): string {
  if (!medication) return SHIFT_CURRENT_NO_MEDICATION_COPY;
  const name = medication.medication_name?.trim() ?? "";
  const strength = medication.strength?.trim() ?? "";
  const label = [name, strength].filter(Boolean).join(" ");
  if (isBlankOrPlaceholder(label)) return SHIFT_CURRENT_NO_MEDICATION_COPY;
  return label;
}

/** Room label when unset, blank, hyphen, or em dash. */
export function formatShiftCurrentRoomLabel(room: string | null | undefined): string {
  if (isBlankOrPlaceholder(room)) return SHIFT_CURRENT_NO_ROOM_COPY;
  return room!.trim();
}
