/**
 * Progressive discipline ladder (handoff — absence-based defaults).
 */

export enum DisciplineAction {
  NONE = "NONE",
  VERBAL_WARNING = "VERBAL_WARNING",
  WRITTEN_WARNING = "WRITTEN_WARNING",
  FINAL_WRITTEN_WARNING = "FINAL_WRITTEN_WARNING",
  TERMINATION = "TERMINATION",
}

const GOOD_CITIZEN_CLEAN_DAYS = 90;

/** Map rolling absence count to next action (3→verbal … 6→termination). */
export function getDisciplineLevel(absenceCount: number): DisciplineAction {
  if (absenceCount <= 2) return DisciplineAction.NONE;
  if (absenceCount === 3) return DisciplineAction.VERBAL_WARNING;
  if (absenceCount === 4) return DisciplineAction.WRITTEN_WARNING;
  if (absenceCount === 5) return DisciplineAction.FINAL_WRITTEN_WARNING;
  return DisciplineAction.TERMINATION;
}

export function shouldResetAbsenceCounter(
  lastIncidentAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastIncidentAt) return false;
  const ms = now.getTime() - lastIncidentAt.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  return days >= GOOD_CITIZEN_CLEAN_DAYS;
}
