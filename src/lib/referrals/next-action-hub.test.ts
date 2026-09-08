import { describe, expect, it } from "vitest";
import { matchesReferralActionFilter, referralActionState } from "./next-action-hub";
const now = Date.parse("2026-09-08T15:00:00Z");
const action = { due_at: null, owner_acknowledged: false, owner_eligible: true, backup_id: "backup", backup_accepted: false, backup_eligible: true };

describe("referral action exceptions", () => {
  it("does not turn an undated waiting condition or invalid date into overdue work", () => {
    expect(referralActionState("new", action, now).overdue).toBe(false);
    expect(referralActionState("new", { ...action, due_at: "invalid" }, now).overdue).toBe(false);
    expect(referralActionState("new", { ...action, due_at: "2026-09-08T14:59:00Z" }, now).overdue).toBe(true);
  });
  it("keeps owner acknowledgment distinct from named or accepted backup coverage", () => {
    expect(referralActionState("contacted", action, now).labels).toContain("Backup coverage not accepted");
    const state = referralActionState("contacted", { ...action, owner_eligible: false, backup_accepted: true }, now);
    expect(state.labels).toEqual(["Owner access unavailable", "Backup coverage accepted"]);
    expect(state.unacknowledged).toBe(true);
    expect(referralActionState("contacted", { ...action, backup_accepted: true, backup_eligible: false }, now).backupCovered).toBe(false);
  });
  it("flags missing work only for active pipeline stages but retains unresolved work after conversion/loss", () => {
    expect(matchesReferralActionFilter("new", undefined, "missing", now)).toBe(true);
    for (const status of ["converted", "lost", "merged"]) expect(matchesReferralActionFilter(status, undefined, "missing", now)).toBe(false);
    for (const status of ["converted", "lost"]) expect(matchesReferralActionFilter(status, { ...action, owner_eligible: false }, "owner_unavailable", now)).toBe(true);
  });
});
