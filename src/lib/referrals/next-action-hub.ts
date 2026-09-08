import type { NextActionView } from "./next-actions";

type ActionEvidence = Pick<NextActionView, "due_at" | "owner_acknowledged" | "owner_eligible" | "backup_id" | "backup_accepted" | "backup_eligible">;

export type ReferralActionFilter = "all" | "missing" | "unacknowledged" | "overdue" | "owner_unavailable";
export const REFERRAL_ACTION_FILTERS: { value: ReferralActionFilter; label: string }[] = [
  { value: "all", label: "All next actions" },
  { value: "missing", label: "Missing next action" },
  { value: "unacknowledged", label: "Owner not acknowledged" },
  { value: "overdue", label: "Due date passed" },
  { value: "owner_unavailable", label: "Owner access unavailable" },
];

export function referralActionState(status: string, action: ActionEvidence | undefined, now: number) {
  const missing = !action && !["converted", "lost", "merged"].includes(status);
  const overdue = !!action?.due_at && Number.isFinite(Date.parse(action.due_at)) && Date.parse(action.due_at) < now;
  const unacknowledged = !!action && !action.owner_acknowledged;
  const ownerUnavailable = !!action && !action.owner_eligible;
  const backupCovered = !!action?.backup_accepted && action.backup_eligible;
  const labels = action ? [
    ownerUnavailable ? "Owner access unavailable" : unacknowledged ? "Owner not acknowledged" : "Owner acknowledged",
    ...(overdue ? ["Due date passed"] : []),
    ...(backupCovered ? ["Backup coverage accepted"] : action.backup_id ? [action.backup_eligible ? "Backup coverage not accepted" : "Backup access unavailable"] : []),
  ] : missing ? ["Missing next action"] : [];
  return { missing, overdue, unacknowledged, ownerUnavailable, backupCovered, labels };
}

export function matchesReferralActionFilter(status: string, action: ActionEvidence | undefined, filter: ReferralActionFilter, now: number) {
  const state = referralActionState(status, action, now);
  return filter === "all" || (filter === "missing" && state.missing)
    || (filter === "unacknowledged" && state.unacknowledged)
    || (filter === "overdue" && state.overdue)
    || (filter === "owner_unavailable" && state.ownerUnavailable);
}
