/**
 * Quiet Operator copy for the admin resident safety scores board (`/admin/rounding/safety`).
 * Missing facility, room, component metrics, and trend name real gaps — never fabricate values.
 */

import { caregiverDisplayRoomLabel } from "@/lib/caregiver/emar-queue-copy";

export const SAFETY_BOARD_NO_FACILITY_COPY = "No facility posted";
/** Header/subtitle scope when a facility id is selected but the name has not resolved. */
export const SAFETY_BOARD_NO_FACILITY_SCOPE_COPY = "No facility name posted";

/** Page header and empty-state facility label — never fabricates "selected facility". */
export function resolveSafetyBoardFacilityScopeLabel(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): string {
  if (!selectedFacilityId) return SAFETY_BOARD_NO_FACILITY_SCOPE_COPY;
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return trimmed;
  return SAFETY_BOARD_NO_FACILITY_SCOPE_COPY;
}
export const SAFETY_BOARD_NO_ROOM_COPY = "No room posted";
export const SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY = "No observation compliance posted";
export const SAFETY_BOARD_NO_INCIDENT_RECENCY_COPY = "No incident recency posted";
export const SAFETY_BOARD_NO_MEDICATION_ADHERENCE_COPY = "No medication adherence posted";
export const SAFETY_BOARD_NO_SCORE_TREND_COPY = "No score trend posted";

/** Facility name on a safety board row when the join is unset or blank. */
export function formatSafetyBoardFacilityName(name: string | null | undefined): string {
  if (!name || !name.trim()) return SAFETY_BOARD_NO_FACILITY_COPY;
  return name;
}

/** Room number on a safety board row — never invents a room label. */
export function formatSafetyBoardRoomNumber(roomNumber: string | null | undefined): string {
  const trimmed = roomNumber?.trim();
  if (!trimmed) return SAFETY_BOARD_NO_ROOM_COPY;
  return caregiverDisplayRoomLabel(trimmed);
}

/** Observation compliance component — real zero stays `0%`. */
export function formatSafetyBoardObservationCompliance(value: number | null | undefined): string {
  if (value != null) return `${value.toFixed(0)}%`;
  return SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY;
}

/** Incident recency component — real zero stays `0`. */
export function formatSafetyBoardIncidentRecency(value: number | null | undefined): string {
  if (value != null) return value.toFixed(0);
  return SAFETY_BOARD_NO_INCIDENT_RECENCY_COPY;
}

/** Medication adherence component — real zero stays `0%`. */
export function formatSafetyBoardMedicationAdherence(value: number | null | undefined): string {
  if (value != null) return `${value.toFixed(0)}%`;
  return SAFETY_BOARD_NO_MEDICATION_ADHERENCE_COPY;
}

/** Score delta / trend column when no prior comparison is posted. */
export function formatSafetyBoardScoreTrendEmpty(): string {
  return SAFETY_BOARD_NO_SCORE_TREND_COPY;
}
