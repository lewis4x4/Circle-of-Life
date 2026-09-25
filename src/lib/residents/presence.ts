import type { StatusPillTone } from "@/components/ui/status-pill";
import { enumLabel } from "@/lib/display/enum-label";

/**
 * Resident presence — the operator-facing projection of the `resident_status`
 * lifecycle enum onto the three presence states COL tracks day-to-day.
 *
 * This is the SINGLE SOURCE OF TRUTH for presence labels, tones, and the
 * UI <-> DB value mapping. The roster status cell, the resident-record presence
 * control, and any future presence surface must read from here so the four
 * historically-divergent copies of this mapping cannot drift again.
 *
 * Decision — HANDOFF_v2 Option A (owner-approved): reuse the existing
 * `resident_status` enum (`active`, `hospital_hold`, `loa`) and relabel in the
 * UI. No new enum value is introduced. A transient "out for an appointment"
 * absence is NOT a lifecycle state and deliberately has no entry here; if that
 * need is confirmed it becomes a separate whereabouts layer.
 */

/** UI presence value. Projection of `resident_status` for the 3 in-census states. */
export type ResidencyStatus = "active" | "hospital" | "loa";

/** The persisted `resident_status` enum values that map to a presence state. */
export type ResidentPresenceDbValue = "active" | "hospital_hold" | "loa";

export type PresenceOption = {
  /** UI presence value. */
  status: ResidencyStatus;
  /** Persisted `resident_status` enum value written on change. */
  dbValue: ResidentPresenceDbValue;
  /** Operator-facing label (COL wording, owner-approved). */
  label: string;
  /** StatusPill tone. */
  tone: StatusPillTone;
  /** Short helper shown in the presence picker. */
  hint: string;
};

const IN_HOUSE: PresenceOption = {
  status: "active",
  dbValue: "active",
  label: "In-house",
  tone: "muted",
  hint: "Present in the facility",
};

const HOSPITAL: PresenceOption = {
  status: "hospital",
  dbValue: "hospital_hold",
  label: "Bed Hold — Hospital or rehab",
  tone: "danger",
  hint: "At a hospital or in rehab; bed held",
};

const ON_LEAVE: PresenceOption = {
  status: "loa",
  dbValue: "loa",
  label: "On leave / vacation",
  tone: "warning",
  hint: "Away on leave; bed held",
};

/** Ordered presence options for pickers (in-house first). */
export const PRESENCE_OPTIONS: readonly PresenceOption[] = [IN_HOUSE, HOSPITAL, ON_LEAVE];

const BY_STATUS: Record<ResidencyStatus, PresenceOption> = {
  active: IN_HOUSE,
  hospital: HOSPITAL,
  loa: ON_LEAVE,
};

/** Map a raw `resident_status` enum value to a UI presence value. */
export function mapResidencyStatus(value: string | null): ResidencyStatus {
  if (value === "hospital_hold") return "hospital";
  if (value === "loa") return "loa";
  return "active";
}

/**
 * True only for the three in-census presence states. Guards the editable
 * presence control: `mapResidencyStatus` projects every non-presence lifecycle
 * value (inquiry, pending_admission, discharged, deceased) onto `"active"`, so
 * callers MUST gate on the raw status before treating a resident as editable —
 * otherwise a discharged/deceased resident renders as "In-house" and a click
 * could resurrect them into a billable presence state.
 */
export function isPresenceStatus(rawStatus: string | null): boolean {
  return rawStatus === "active" || rawStatus === "hospital_hold" || rawStatus === "loa";
}

const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  pending_admission: "Pending admission",
  discharged: "Discharged",
  deceased: "Deceased",
};

/** Read-only label for a non-presence lifecycle status (never edited via presence). */
export function lifecycleStatusLabel(rawStatus: string | null): string {
  if (!rawStatus) return "Status unknown";
  return LIFECYCLE_STATUS_LABELS[rawStatus] ?? enumLabel(rawStatus);
}

/** UI presence value -> persisted `resident_status` enum value (for the write path). */
export function residencyStatusToDbValue(status: ResidencyStatus): ResidentPresenceDbValue {
  return BY_STATUS[status].dbValue;
}

/**
 * COL-755: a bed-hold stay is at a hospital or in rehab (`residents.bed_hold_stay_type`).
 * Null is a stay whose type was never recorded (every stay before 2026-09-24);
 * it is said so, never guessed. Census, billing and bed hold treat both alike.
 */
export type BedHoldStayType = "hospital" | "rehab";
export const BED_HOLD_STAY_TYPES: readonly BedHoldStayType[] = ["hospital", "rehab"];
export const isBedHoldStayType = (value: unknown): value is BedHoldStayType =>
  value === "hospital" || value === "rehab";

const BED_HOLD_LABELS: Record<BedHoldStayType, string> = {
  hospital: "Bed Hold — Hospital",
  rehab: "Bed Hold — Rehab",
};
export const BED_HOLD_TYPE_NOT_RECORDED = "Bed Hold — Hospital or rehab (type not recorded)";

/** The label of one bed-hold stay by its recorded type. */
export function bedHoldLabel(stayType: BedHoldStayType | null): string {
  return stayType ? BED_HOLD_LABELS[stayType] : BED_HOLD_TYPE_NOT_RECORDED;
}

/**
 * Operator-facing presence label. Pass the stay type (null when not recorded)
 * where it is known; without it a bed hold reads "Hospital or rehab".
 */
export function presenceLabel(status: ResidencyStatus, stayType?: BedHoldStayType | null): string {
  if (status === "hospital" && stayType !== undefined) return bedHoldLabel(stayType);
  return BY_STATUS[status].label;
}

/** StatusPill tone for a presence value. */
export function presenceTone(status: ResidencyStatus): StatusPillTone {
  return BY_STATUS[status].tone;
}

/** Full picker option for a presence value. */
export function presenceOption(status: ResidencyStatus): PresenceOption {
  return BY_STATUS[status];
}

/**
 * COL-755: the presence picker offers hospital and rehab as two choices of the
 * one bed-hold status. `stayType` is undefined for non-hold choices.
 */
export type PresenceChoiceKey = "active" | "hospital" | "rehab" | "loa";
export type PresenceChoice = {
  key: PresenceChoiceKey;
  status: ResidencyStatus;
  dbValue: ResidentPresenceDbValue;
  stayType?: BedHoldStayType;
  label: string;
  tone: StatusPillTone;
  hint: string;
};
export const PRESENCE_CHOICES: readonly PresenceChoice[] = [
  { key: "active", status: "active", dbValue: "active", label: IN_HOUSE.label, tone: IN_HOUSE.tone, hint: IN_HOUSE.hint },
  { key: "hospital", status: "hospital", dbValue: "hospital_hold", stayType: "hospital", label: BED_HOLD_LABELS.hospital, tone: HOSPITAL.tone, hint: "Admitted to a hospital; bed held" },
  { key: "rehab", status: "hospital", dbValue: "hospital_hold", stayType: "rehab", label: BED_HOLD_LABELS.rehab, tone: HOSPITAL.tone, hint: "In rehab; bed held" },
  { key: "loa", status: "loa", dbValue: "loa", label: ON_LEAVE.label, tone: ON_LEAVE.tone, hint: ON_LEAVE.hint },
];
export const presenceChoice = (key: PresenceChoiceKey): PresenceChoice => PRESENCE_CHOICES.find((choice) => choice.key === key)!;

/** The picker's current choice; null for a bed-hold stay whose type was never recorded. */
export function currentPresenceChoice(status: ResidencyStatus, stayType: BedHoldStayType | null | undefined): PresenceChoiceKey | null {
  if (status === "hospital") return stayType ?? null;
  return status;
}

/**
 * What choosing `to` does from the current presence:
 * - `none`: already there;
 * - `record_type`: the stay in force is a bed hold whose type was never
 *   recorded; naming it corrects that stay and moves nothing (no date asked);
 * - `movement`: a dated change (a status change, or hospital to rehab on a
 *   recorded stay), asked "when did this happen?".
 */
export function presenceChange(status: ResidencyStatus, stayType: BedHoldStayType | null | undefined, to: PresenceChoiceKey): "none" | "record_type" | "movement" {
  const current = currentPresenceChoice(status, stayType);
  if (current === to) return "none";
  const target = presenceChoice(to);
  if (status === "hospital" && current === null && target.status === "hospital") return "record_type";
  return "movement";
}
