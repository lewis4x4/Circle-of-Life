/**
 * Quiet Operator copy for the caregiver eMAR queue (`/caregiver/meds`).
 * Empty states name real gaps — never fabricate doses, rooms, or counts.
 */

export const CAREGIVER_EMAR_LOADING_COPY = "Loading this pass…";

export const CAREGIVER_EMAR_BACK_TO_SHIFT_COPY = "Back to this shift";

export const CAREGIVER_EMAR_NO_ROOM_LABEL = "No room on file";

export type CaregiverEmarMetricKey = "due-now" | "due-soon" | "in-window";

const EMPTY_METRIC_COPY: Record<CaregiverEmarMetricKey, string> = {
  "due-now": "No doses due now",
  "due-soon": "No doses due soon",
  "in-window": "No doses in this window",
};

/** One-line reason a metric tile shows a message instead of a numeric count. */
export function caregiverEmarMetricEmptyCopy(metricKey: CaregiverEmarMetricKey): string {
  return EMPTY_METRIC_COPY[metricKey];
}

export type CaregiverEmarMetricDisplay =
  | { mode: "number"; text: string }
  | { mode: "message"; text: string };

/**
 * When the pass queue is empty, metric tiles use calm message copy.
 * Loaded zeros on a non-empty queue stay numeric.
 */
export function caregiverEmarMetricDisplay(
  count: number,
  metricKey: CaregiverEmarMetricKey,
  queueHasSlots: boolean,
): CaregiverEmarMetricDisplay {
  if (queueHasSlots) {
    return { mode: "number", text: String(count) };
  }
  return { mode: "message", text: caregiverEmarMetricEmptyCopy(metricKey) };
}

/** Title for a successful load with zero slots in the pass window. */
export function caregiverEmarEmptyNoticeTitle(): string {
  return "No doses in this pass window";
}

/** Helper line under the empty-queue title. */
export function caregiverEmarEmptyNoticeHelper(): string {
  return "The queue fills from active medications with scheduled times. Ask a nurse if a pass should be on the board.";
}

/** Build a queue row room label from bed/room data — never a silent dash. */
export function formatCaregiverEmarRoomLabel(input: {
  roomNumber?: string | null;
  bedLabel?: string | null;
}): string {
  const roomNumber = input.roomNumber?.trim();
  if (!roomNumber) return CAREGIVER_EMAR_NO_ROOM_LABEL;
  const bedLabel = input.bedLabel?.trim();
  return bedLabel ? `${roomNumber}-${bedLabel}` : roomNumber;
}
