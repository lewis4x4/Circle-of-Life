import { describe, expect, it } from "vitest";

import {
  canRunStaffCheck,
  duplicateTargetChoices,
  duplicateTargetRequired,
  hasDuplicateCandidates,
  lastSignInLabel,
  staffCheckClosedSummary,
  staffCheckFixDetail,
  staffCheckProgress,
  staffCheckProgressLine,
  staffCheckResultInsert,
  staffCheckResultLabel,
  staffCheckSubjectKey,
  staffCloseRefusalMessage,
  staffGrantReassignmentNote,
  type StaffCheckStateRow,
} from "@/lib/facility-checks/staff-check";

function identity(overrides: Partial<StaffCheckStateRow> = {}): StaffCheckStateRow {
  return {
    subject_user_profile_id: "profile-1",
    subject_staff_id: "staff-1",
    display_name: "Test Staff A",
    role_label: "cna",
    facility_grant_count: 1,
    last_sign_in_at: null,
    is_active: true,
    duplicate_candidate_user_profile_ids: [],
    duplicate_candidate_staff_ids: [],
    duplicate_candidate_count: 0,
    latest_result: null,
    duplicate_of_user_profile_id: null,
    duplicate_of_staff_id: null,
    unmarked: true,
    fix_open: false,
    ...overrides,
  };
}

describe("staff check progress", () => {
  it("counts resolved identities and pending deactivations", () => {
    const progress = staffCheckProgress([
      identity({ unmarked: false }),
      identity({ subject_staff_id: "staff-2", unmarked: false, fix_open: true }),
      identity({ subject_staff_id: "staff-3" }),
    ]);
    expect(progress).toMatchObject({ total: 3, checked: 2, deactivationsPending: 1, canClose: false });
    expect(staffCheckProgressLine(progress)).toBe("2 of 3 identities checked · 1 deactivation pending");
  });

  it("closes only at zero unresolved and zero pending", () => {
    expect(staffCheckProgress([identity({ unmarked: false })]).canClose).toBe(true);
    expect(staffCheckProgress([identity()]).canClose).toBe(false);
    expect(staffCheckProgress([identity({ unmarked: false, fix_open: true })]).canClose).toBe(false);
    expect(staffCheckProgress([]).canClose).toBe(false);
  });

  it("names what is left", () => {
    expect(staffCloseRefusalMessage({ total: 19, checked: 17, deactivationsPending: 2, canClose: false })).toBe(
      "2 identities are still unresolved and 2 deactivations have not gone through yet. Finish those before closing the check.",
    );
  });
});

describe("result vocabulary", () => {
  it("offers exactly keep, deactivate and duplicate", () => {
    expect(staffCheckResultLabel("keep")).toBe("Keep");
    expect(staffCheckResultLabel("deactivate")).toBe("Deactivate");
    expect(staffCheckResultLabel("duplicate_of")).toBe("Duplicate of…");
  });
});

describe("duplicate candidates", () => {
  it("badges an identity the database suggested", () => {
    expect(hasDuplicateCandidates(identity({ duplicate_candidate_count: 2 }))).toBe(true);
    expect(hasDuplicateCandidates(identity())).toBe(false);
  });

  it("puts suggestions first and only searches beyond them on request", () => {
    const subject = identity({
      subject_staff_id: "staff-1",
      subject_user_profile_id: "profile-1",
      duplicate_candidate_staff_ids: ["staff-2"],
      duplicate_candidate_count: 1,
    });
    const rows = [
      subject,
      identity({ subject_staff_id: "staff-2", subject_user_profile_id: "profile-2", display_name: "Zed Suggested" }),
      identity({ subject_staff_id: "staff-3", subject_user_profile_id: "profile-3", display_name: "Alpha Unrelated" }),
    ];

    expect(duplicateTargetChoices(subject, rows, "").map((row) => row.display_name)).toEqual(["Zed Suggested"]);
    expect(duplicateTargetChoices(subject, rows, "alpha").map((row) => row.display_name)).toEqual([
      "Zed Suggested",
      "Alpha Unrelated",
    ]);
  });

  it("never offers the identity as its own duplicate", () => {
    const subject = identity({ duplicate_candidate_staff_ids: ["staff-1"], duplicate_candidate_count: 1 });
    expect(duplicateTargetChoices(subject, [subject], "")).toEqual([]);
  });

  it("refuses a duplicate with no target, the way the database does", () => {
    expect(duplicateTargetRequired("duplicate_of", null)).toBe(true);
    expect(duplicateTargetRequired("duplicate_of", { subject_user_profile_id: null, subject_staff_id: null })).toBe(true);
    expect(duplicateTargetRequired("duplicate_of", { subject_user_profile_id: null, subject_staff_id: "staff-2" })).toBe(false);
    expect(duplicateTargetRequired("keep", null)).toBe(false);
  });
});

describe("what is still outstanding", () => {
  it("says nothing while no fix is open", () => {
    expect(staffCheckFixDetail(identity({ latest_result: "keep", unmarked: false }))).toBeNull();
    expect(staffCheckFixDetail(identity({ latest_result: "deactivate", unmarked: false }))).toBeNull();
  });

  it("explains that a deactivation is two halves", () => {
    const detail = staffCheckFixDetail(identity({ latest_result: "deactivate", unmarked: false, fix_open: true }));
    expect(detail).toContain("ends employment and revokes the Haven login");
  });

  it("says a duplicate is offboarded and reassigned, never merged", () => {
    const detail = staffCheckFixDetail(identity({ latest_result: "duplicate_of", unmarked: false, fix_open: true }));
    expect(detail).toContain("Nothing is merged");
  });

  it("counts the grants a duplicate leaves behind", () => {
    expect(staffGrantReassignmentNote(identity({ latest_result: "duplicate_of", facility_grant_count: 3 }))).toBe(
      "3 facility grants to reassign in the grant screen.",
    );
    expect(staffGrantReassignmentNote(identity({ latest_result: "duplicate_of", facility_grant_count: 0 }))).toBe(
      "No facility grants to reassign.",
    );
    expect(staffGrantReassignmentNote(identity({ latest_result: "keep" }))).toBeNull();
  });
});

describe("recording a decision", () => {
  it("carries both ids for a staff subject so the latest result keys the same way", () => {
    const insert = staffCheckResultInsert({
      organizationId: "org-1",
      sessionId: "session-1",
      row: identity(),
      result: "keep",
      recordedBy: "user-1",
    });
    expect(insert).toMatchObject({
      subject_user_profile_id: "profile-1",
      subject_staff_id: "staff-1",
      result: "keep",
      duplicate_of_user_profile_id: null,
      duplicate_of_staff_id: null,
    });
  });

  it("names the duplicate target, and drops it when the result is not a duplicate", () => {
    const target = { subject_user_profile_id: "profile-2", subject_staff_id: "staff-2" };
    expect(
      staffCheckResultInsert({
        organizationId: "org-1",
        sessionId: "session-1",
        row: identity(),
        result: "duplicate_of",
        duplicateOf: target,
        recordedBy: "user-1",
      }),
    ).toMatchObject({ duplicate_of_user_profile_id: "profile-2", duplicate_of_staff_id: "staff-2" });

    expect(
      staffCheckResultInsert({
        organizationId: "org-1",
        sessionId: "session-1",
        row: identity(),
        result: "keep",
        duplicateOf: target,
        recordedBy: "user-1",
      }),
    ).toMatchObject({ duplicate_of_user_profile_id: null, duplicate_of_staff_id: null });
  });
});

describe("subject keys", () => {
  it("keeps a staff row and a bare profile apart", () => {
    expect(staffCheckSubjectKey({ subject_staff_id: "s1", subject_user_profile_id: "p1" })).toBe("s1:p1");
    expect(staffCheckSubjectKey({ subject_staff_id: null, subject_user_profile_id: "p1" })).toBe(":p1");
  });
});

describe("last sign in", () => {
  it("says never rather than showing a blank", () => {
    expect(lastSignInLabel(null, () => "x")).toBe("Never signed in");
    expect(lastSignInLabel("2026-09-16T12:00:00Z", () => "Sep 16, 8:00 a.m.")).toBe("Sep 16, 8:00 a.m.");
  });
});

describe("who may run a staff check", () => {
  it("matches the roles that can deactivate staff", () => {
    for (const role of ["owner", "org_admin", "facility_admin"]) {
      expect(canRunStaffCheck(role)).toBe(true);
    }
    for (const role of ["nurse", "caregiver", "dietary", "family"]) {
      expect(canRunStaffCheck(role)).toBe(false);
    }
  });
});

describe("a closed check", () => {
  it("reads as the proof it is", () => {
    expect(
      staffCheckClosedSummary({
        closedAt: "2026-09-16T19:42:00Z",
        closedByName: "Test Admin A",
        total: 19,
        formatDateTime: () => "Sep 16, 3:42 p.m.",
      }),
    ).toBe("Closed Sep 16, 3:42 p.m. by Test Admin A · 19 of 19 resolved");
  });
});
