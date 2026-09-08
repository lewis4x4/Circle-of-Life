/**
 * Historical draft-source ladder. Labels are proposals, never executable employment actions.
 */

export enum DisciplineAction {
  NONE = "NONE",
  VERBAL_WARNING = "VERBAL_WARNING",
  WRITTEN_WARNING = "WRITTEN_WARNING",
  FINAL_WRITTEN_WARNING = "FINAL_WRITTEN_WARNING",
  TERMINATION = "TERMINATION",
}

/** @deprecated Historical source label only. Use assessAttendanceReview for candidate notices. */
export function getDisciplineLevel(absenceCount: number): DisciplineAction {
  if (absenceCount <= 2) return DisciplineAction.NONE;
  if (absenceCount === 3) return DisciplineAction.VERBAL_WARNING;
  if (absenceCount === 4) return DisciplineAction.WRITTEN_WARNING;
  if (absenceCount === 5) return DisciplineAction.FINAL_WRITTEN_WARNING;
  return DisciplineAction.TERMINATION;
}

/** Compatibility guard: approved credits retract an action, never erase occurrence history. */
export function shouldResetAbsenceCounter(
  lastIncidentAt: Date | null,
  now: Date = new Date(),
): boolean {
  void lastIncidentAt;
  void now;
  return false;
}
