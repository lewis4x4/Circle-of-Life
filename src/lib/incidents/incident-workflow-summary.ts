import { isFollowupEscalated } from "@/lib/incidents/followup-escalation";
import type {
  IncidentDetailView,
  RcaInvestigationUi,
  SupabaseIncidentDetail,
} from "@/lib/incidents/load-incident-detail";
import { canClaimAllClear } from "@/lib/metrics/metric-state";

/**
 * Incident detail "Workflow Summary". The green all-clear line renders only
 * when `operationallyClear`: the incident is resolved or closed and nothing is
 * left to do.
 */
export const INCIDENT_OPERATIONALLY_CLEAR_COPY =
  "This incident is operationally clear. Follow-ups, reporting, RCA, and care-plan expectations are in a good state.";

export function buildIncidentWorkflowSummary(
  incident: SupabaseIncidentDetail,
  rcaInvestigation: RcaInvestigationUi,
  followups: IncidentDetailView["followups"],
  openObligations: string[],
  now: Date = new Date(),
) {
  const openFollowups = followups.filter((item) => !item.isCompleted);
  const overdueFollowups = openFollowups.filter((item) => item.isOverdue).length;
  const unassignedFollowups = openFollowups.filter((item) => !item.assignedToId).length;
  const escalatedFollowups = openFollowups.filter((item) => isFollowupEscalated(item.escalationLevel)).length;
  const rootCauseExpected =
    incident.severity === "level_3" ||
    incident.severity === "level_4" ||
    followups.some((item) => item.taskType === "root_cause_analysis");
  const carePlanPending =
    Boolean(incident.resolved_at) &&
    !incident.care_plan_updated &&
    (incident.severity === "level_3" || incident.severity === "level_4" || openFollowups.length > 0);

  // An incident nobody has resolved is not "operationally clear", even with no
  // follow-ups, obligations or RCA expected (COL-649: an Open incident,
  // untriaged for 100 days, read green).
  const stillOpen = incident.status === "open" || incident.status === "investigating";
  const openDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(incident.discovered_at ?? incident.occurred_at).getTime()) / 86_400_000),
  );

  const nextActions: string[] = [];
  if (stillOpen) {
    nextActions.push(
      `${incident.status === "open" ? "Triage" : "Finish the investigation of"} this incident and resolve it — it has been ${incident.status} for ${openDays} day${openDays === 1 ? "" : "s"}.`,
    );
  }
  if (openObligations.length > 0) {
    nextActions.push(...openObligations);
  }
  if (escalatedFollowups > 0) {
    nextActions.push("Work the escalated follow-ups before closure or sign-off.");
  } else if (overdueFollowups > 0) {
    nextActions.push("Clear overdue follow-ups before the incident can move cleanly toward closure.");
  }
  if (unassignedFollowups > 0) {
    nextActions.push("Assign the remaining unassigned follow-up work.");
  }
  if (rootCauseExpected && rcaInvestigation !== "complete") {
    nextActions.push("Complete the root cause investigation for this incident.");
  }
  if (carePlanPending) {
    nextActions.push("Document the care-plan update before closing the incident loop.");
  }

  let summary = "No outstanding workflow pressure.";
  let tone: "clear" | "warning" = "clear";
  if (stillOpen) {
    summary = `The incident is still ${incident.status}; it has not been resolved.`;
    tone = "warning";
  } else if (openObligations.length > 0) {
    summary = "Notifications or regulatory reporting are still incomplete.";
    tone = "warning";
  } else if (escalatedFollowups > 0) {
    summary = "Chronically overdue follow-up work is driving the current incident risk.";
    tone = "warning";
  } else if (overdueFollowups > 0 || unassignedFollowups > 0) {
    summary = "Follow-up execution still needs operator attention.";
    tone = "warning";
  } else if (rootCauseExpected && rcaInvestigation !== "complete") {
    summary = "Root cause analysis is the main remaining incident workflow step.";
    tone = "warning";
  } else if (carePlanPending) {
    summary = "Care-plan closure is the last operational step still pending.";
    tone = "warning";
  }

  return {
    summary,
    tone,
    openFollowups: openFollowups.length,
    overdueFollowups,
    unassignedFollowups,
    escalatedFollowups,
    openObligations: openObligations.length,
    operationallyClear: canClaimAllClear({ scopeSize: 1, issueCount: nextActions.length }) && !stillOpen,
    rcaLabel: rcaInvestigation === "complete" ? "complete" : rcaInvestigation === "draft" ? "draft" : "not started",
    nextActions,
  };
}
