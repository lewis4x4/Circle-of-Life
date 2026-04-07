import type { ObservationTaskStatus } from "@/lib/rounding/types";

type TaskTimingInput = {
  dueAt: string | Date;
  graceEndsAt: string | Date;
  now?: string | Date;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function calculateObservationTaskStatus(input: TaskTimingInput): ObservationTaskStatus {
  const now = toDate(input.now ?? new Date());
  const dueAt = toDate(input.dueAt);
  const graceEndsAt = toDate(input.graceEndsAt);

  if (Number.isNaN(dueAt.getTime()) || Number.isNaN(graceEndsAt.getTime())) {
    return "missed";
  }

  const msUntilDue = dueAt.getTime() - now.getTime();
  const msUntilGraceEnds = graceEndsAt.getTime() - now.getTime();

  if (msUntilDue > 30 * 60 * 1000) {
    return "upcoming";
  }

  if (msUntilDue > 0) {
    return "due_soon";
  }

  if (msUntilGraceEnds >= 0) {
    return "due_now";
  }

  const minutesPastGrace = Math.abs(msUntilGraceEnds) / (60 * 1000);
  if (minutesPastGrace <= 30) {
    return "overdue";
  }

  if (minutesPastGrace <= 120) {
    return "critically_overdue";
  }

  return "missed";
}

export function getCompletionTaskStatus(input: {
  observedAt: string | Date;
  graceEndsAt: string | Date;
}): ObservationTaskStatus {
  const observedAt = toDate(input.observedAt);
  const graceEndsAt = toDate(input.graceEndsAt);

  if (Number.isNaN(observedAt.getTime()) || Number.isNaN(graceEndsAt.getTime())) {
    return "completed_late";
  }

  return observedAt.getTime() <= graceEndsAt.getTime() ? "completed_on_time" : "completed_late";
}
