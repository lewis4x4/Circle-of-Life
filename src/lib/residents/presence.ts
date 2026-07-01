import type { StatusPillTone } from "@/components/ui/status-pill";

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
  label: "Bed Hold — Hospital",
  tone: "danger",
  hint: "Admitted to hospital; bed held",
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
  return LIFECYCLE_STATUS_LABELS[rawStatus] ?? rawStatus.replace(/_/g, " ");
}

/** UI presence value -> persisted `resident_status` enum value (for the write path). */
export function residencyStatusToDbValue(status: ResidencyStatus): ResidentPresenceDbValue {
  return BY_STATUS[status].dbValue;
}

/** Operator-facing presence label. */
export function presenceLabel(status: ResidencyStatus): string {
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
