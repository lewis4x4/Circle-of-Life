/**
 * Quiet Operator copy for the admin resident safety scores board (`/admin/rounding/safety`).
 * Missing facility, room, component metrics, and trend name real gaps — never fabricate values.
 */

import { caregiverDisplayRoomLabel } from "@/lib/caregiver/emar-queue-copy";

export const SAFETY_BOARD_NO_FACILITY_COPY = "No facility posted";
/** Stand-alone gap when a facility id is selected but the name has not resolved. */
export const SAFETY_BOARD_NO_FACILITY_SCOPE_COPY = "No facility name posted";

export type SafetyBoardFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope — never fabricates a facility name. */
export function resolveSafetyBoardFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): SafetyBoardFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

/** Empty-state title when a facility is scoped but no scores exist yet. */
export function formatSafetyBoardNoScoresEmptyTitle(scope: SafetyBoardFacilityScope): string {
  if (scope.kind === "named") return `No safety scores at ${scope.name}`;
  if (scope.kind === "missing_name") return "No safety scores posted";
  return "No safety scores posted";
}

/** Empty-state title when a facility is scoped but no insights exist yet. */
export function formatInsightsBoardNoInsightsEmptyTitle(scope: SafetyBoardFacilityScope): string {
  if (scope.kind === "named") return `No rounding activity insights at ${scope.name}`;
  if (scope.kind === "missing_name") return "No rounding activity insights posted";
  return "No rounding activity insights posted";
}
export const SAFETY_BOARD_NO_ROOM_COPY = "No room posted";
export const SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY = "No observation compliance posted";
export const SAFETY_BOARD_NO_INCIDENT_RECENCY_COPY = "No incident recency posted";
export const SAFETY_BOARD_NO_MEDICATION_ADHERENCE_COPY = "No medication adherence posted";
export const SAFETY_BOARD_NO_SCORE_TREND_COPY = "No score trend posted";

/** Rose retry banner — facility scope is already selected; do not ask to confirm it. */
export const SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY =
  "Could not load safety scores. Try again, or contact support if this persists.";

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
