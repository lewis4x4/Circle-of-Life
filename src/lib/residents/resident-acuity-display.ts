/**
 * Documented acuity — one reading of `residents.acuity_level` for every resident
 * surface. The roster and the resident overview both call this so a resident
 * whose acuity was never assessed reads "No acuity posted" on both pages
 * instead of a fallback "level 1" on one and a gap on the other.
 */

import { RESIDENT_ROSTER_NO_ACUITY_COPY } from "./roster-display-copy";

export const RESIDENT_ACUITY_NOT_RECORDED_COPY = RESIDENT_ROSTER_NO_ACUITY_COPY;

export type DocumentedAcuityLevel = 1 | 2 | 3;

export type AcuityDisplayTone = "gap" | "muted" | "warning" | "danger";

export type AcuityDisplay = {
  /** Documented level, or null when no assessment is recorded. */
  level: DocumentedAcuityLevel | null;
  label: string;
  tone: AcuityDisplayTone;
};

/** Parse the stored enum value; anything other than a known level is "not recorded". */
export function parseDocumentedAcuityLevel(raw: string | null | undefined): DocumentedAcuityLevel | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "level_1") return 1;
  if (value === "level_2") return 2;
  if (value === "level_3") return 3;
  return null;
}

export function isAcuityRecorded(raw: string | null | undefined): boolean {
  return parseDocumentedAcuityLevel(raw) != null;
}

/** Label + tone for a stored acuity value. Missing data is a named gap, never a level. */
export function acuityDisplay(raw: string | null | undefined): AcuityDisplay {
  const level = parseDocumentedAcuityLevel(raw);
  if (level == null) return { level: null, label: RESIDENT_ACUITY_NOT_RECORDED_COPY, tone: "gap" };
  if (level === 3) return { level, label: "Acuity 3", tone: "danger" };
  if (level === 2) return { level, label: "Acuity 2", tone: "warning" };
  return { level, label: "Acuity 1", tone: "muted" };
}
