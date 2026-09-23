import { canClaimAllClear } from "@/lib/metrics/metric-state";

/**
 * What an empty triage inbox on /admin may say (COL-649). "Inbox zero · all
 * operational exceptions resolved" only after the read covered residents and
 * nothing else on the page is open; otherwise say the inbox is empty and name
 * what it leaves out.
 */
export function triageInboxEmptyCopy(input: {
  residentCount: number;
  openEscalations: number;
  pendingWatchApprovals: number;
}): { clear: boolean; headline: string; body: string } {
  const openElsewhere = input.openEscalations + input.pendingWatchApprovals;
  if (canClaimAllClear({ scopeSize: input.residentCount, issueCount: openElsewhere })) {
    return { clear: true, headline: "Inbox zero", body: "No open exceptions in the triage inbox." };
  }
  if (input.residentCount <= 0) {
    return {
      clear: false,
      headline: "Triage inbox empty",
      body: "No residents are on the roster in this scope, so there was nothing to check. This is not an all-clear.",
    };
  }
  const parts = [
    input.openEscalations > 0
      ? `${input.openEscalations} open rounding ${input.openEscalations === 1 ? "escalation" : "escalations"}`
      : null,
    input.pendingWatchApprovals > 0
      ? `${input.pendingWatchApprovals} ${input.pendingWatchApprovals === 1 ? "watch" : "watches"} awaiting approval`
      : null,
  ].filter(Boolean);
  return {
    clear: false,
    headline: "Triage inbox empty",
    body: `Resident assurance still has ${parts.join(" and ")}. This is not an all-clear.`,
  };
}
