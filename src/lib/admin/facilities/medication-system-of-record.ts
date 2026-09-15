/**
 * Which system holds a facility's medication orders of record.
 *
 * Haven has its own eMAR, but a facility may run orders in an external
 * system (Homewood: QuickMAR by PointClickCare). A care-plan medication line
 * that says "per physician orders" has to name where those orders live, and
 * a printed plan has to say what to attach. Stored in facilities.settings so
 * no migration is needed; `null` is an honest "not set", never a default.
 */

export const MEDICATION_SYSTEMS_OF_RECORD = ["haven_emar", "quickmar", "other"] as const;
export type MedicationSystemOfRecordKey = (typeof MEDICATION_SYSTEMS_OF_RECORD)[number];

export const MEDICATION_SYSTEM_LABELS: Record<MedicationSystemOfRecordKey, string> = {
  haven_emar: "Haven eMAR",
  quickmar: "QuickMAR (PointClickCare)",
  other: "Another system",
};

export const MEDICATION_SYSTEM_NOT_SET_COPY = "Medication system of record not set";

export type MedicationSystemOfRecord = {
  key: MedicationSystemOfRecordKey;
  /** Display label; the custom label when `other` names one. */
  label: string;
  /** True when orders live outside Haven, so a printout must attach them. */
  external: boolean;
};

export function isMedicationSystemOfRecordKey(value: unknown): value is MedicationSystemOfRecordKey {
  return typeof value === "string" && (MEDICATION_SYSTEMS_OF_RECORD as readonly string[]).includes(value);
}

/** Read the setting from a facilities.settings JSON value; anything malformed reads as not set. */
export function medicationSystemOfRecordFromSettings(settings: unknown): MedicationSystemOfRecord | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const s = settings as Record<string, unknown>;
  const key = s.medication_system_of_record;
  if (!isMedicationSystemOfRecordKey(key)) return null;
  const custom = typeof s.medication_system_label === "string" ? s.medication_system_label.trim() : "";
  const label = key === "other" && custom ? custom : MEDICATION_SYSTEM_LABELS[key];
  return { key, label, external: key !== "haven_emar" };
}

export function formatMedicationSystemOfRecord(system: MedicationSystemOfRecord | null): string {
  return system ? `Orders of record: ${system.label}` : MEDICATION_SYSTEM_NOT_SET_COPY;
}

/** What the printed plan asks the reader to attach when orders live outside Haven. */
export function formatMedicationOrdersAttachment(system: MedicationSystemOfRecord | null): string | null {
  if (!system || !system.external) return null;
  return `Attach the current orders printout from ${system.label}.`;
}
