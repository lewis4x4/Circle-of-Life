export const FOLLOWUP_ESCALATION_HOURS = {
  escalated: 48,
  critical: 72,
} as const;

export type FollowupEscalationLevel = "none" | "overdue" | "escalated" | "critical";

export function classifyFollowupEscalation(hoursOverdue: number): FollowupEscalationLevel {
  if (hoursOverdue >= FOLLOWUP_ESCALATION_HOURS.critical) {
    return "critical";
  }
  if (hoursOverdue >= FOLLOWUP_ESCALATION_HOURS.escalated) {
    return "escalated";
  }
  if (hoursOverdue > 0) {
    return "overdue";
  }
  return "none";
}

export function isFollowupEscalated(level: FollowupEscalationLevel) {
  return level === "escalated" || level === "critical";
}

export function followupEscalationLabel(level: FollowupEscalationLevel, hoursOverdue: number) {
  if (level === "critical") {
    return `${hoursOverdue}h overdue · critical`;
  }
  if (level === "escalated") {
    return `${hoursOverdue}h overdue · escalated`;
  }
  if (level === "overdue") {
    return `${hoursOverdue}h overdue`;
  }
  return "On track";
}
