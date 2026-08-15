/**
 * Quiet Operator staff labels for training competency views.
 * Names real gaps — never fabricate staff names.
 */

export const TRAINING_NO_STAFF_COPY = "No staff posted";
export const TRAINING_NO_NAME_COPY = "No name posted";

export type TrainingStaffNameFields = {
  first_name: string;
  last_name: string;
};

/** Staff label on a competency demonstration row when the join may be unset or blank. */
export function formatTrainingStaffLabel(
  staff: TrainingStaffNameFields | null | undefined,
): string {
  if (!staff) return TRAINING_NO_STAFF_COPY;
  const first = staff.first_name.trim();
  const last = staff.last_name.trim();
  if (!first && !last) return TRAINING_NO_NAME_COPY;
  return [first, last].filter(Boolean).join(" ");
}
