import { describe, expect, it } from "vitest";

import {
  EMPTY_VISITOR_DRAFT,
  VISITABLE_RESIDENT_STATUSES,
  inTheBuildingNow,
  openVisitorCount,
  signOutEveryoneConfirmation,
  validateVisitorSignIn,
  visitorTypeLabel,
  voidReasonLabel,
  type VisitorLogRow,
} from "@/lib/registers/visitor-log";

function entry(overrides: Partial<VisitorLogRow>): VisitorLogRow {
  return {
    id: "v1",
    visitorName: "Test Visitor One",
    visitorPhone: null,
    visitorType: "family_friend",
    visitingType: "resident",
    visitingResidentId: "r1",
    visitingResidentName: "Test Resident A",
    signedInAt: "2026-06-10T18:00:00Z",
    signedInByName: "Review clerk",
    signedOutAt: null,
    signedOutByName: null,
    signOutMethod: null,
    voidedAt: null,
    voidReason: null,
    leftOpen: false,
    ...overrides,
  };
}

describe("sign in validation", () => {
  it("asks for a name", () => {
    expect(validateVisitorSignIn(EMPTY_VISITOR_DRAFT)).toContain("Enter the visitor's name.");
  });

  it("asks which resident when the visit is to a resident", () => {
    const problems = validateVisitorSignIn({ ...EMPTY_VISITOR_DRAFT, name: "Test Visitor" });
    expect(problems).toContain("Choose the resident being visited.");
  });

  it("does not ask for a resident when the visit is to staff or the facility", () => {
    for (const visitingType of ["staff", "facility"] as const) {
      expect(
        validateVisitorSignIn({ ...EMPTY_VISITOR_DRAFT, name: "Test Visitor", visitingType }),
      ).toEqual([]);
    }
  });

  it("accepts a blank phone and rejects one that is not a phone number", () => {
    const base = { ...EMPTY_VISITOR_DRAFT, name: "Test Visitor", visitingType: "facility" as const };
    expect(validateVisitorSignIn({ ...base, phone: "" })).toEqual([]);
    expect(validateVisitorSignIn({ ...base, phone: "(386) 555-0100" })).toEqual([]);
    expect(validateVisitorSignIn({ ...base, phone: "call me" })).toHaveLength(1);
  });

  it("refuses a name longer than the column", () => {
    const problems = validateVisitorSignIn({
      ...EMPTY_VISITOR_DRAFT,
      name: "x".repeat(121),
      visitingType: "facility",
    });
    expect(problems).toContain("The visitor's name is too long for the log.");
  });
});

describe("in the building now", () => {
  it("lists open entries oldest first and leaves out signed out and voided ones", () => {
    const rows = [
      entry({ id: "late", signedInAt: "2026-06-10T20:00:00Z" }),
      entry({ id: "early", signedInAt: "2026-06-10T14:00:00Z" }),
      entry({ id: "gone", signedOutAt: "2026-06-10T19:00:00Z" }),
      entry({ id: "void", voidedAt: "2026-06-10T19:00:00Z", voidReason: "duplicate" }),
    ];
    expect(inTheBuildingNow(rows).map((r) => r.id)).toEqual(["early", "late"]);
    expect(openVisitorCount(rows)).toBe(2);
  });
});

describe("sign out everyone", () => {
  it("says the count so nobody has to take it on trust", () => {
    expect(signOutEveryoneConfirmation(4)).toBe("Sign out all 4 visitors still in the building?");
    expect(signOutEveryoneConfirmation(1)).toBe("Sign out the 1 visitor still in the building?");
  });
});

describe("visitor types", () => {
  it("labels a surveyor without shouting the enum value", () => {
    expect(visitorTypeLabel("surveyor_regulator")).toBe("Surveyor or regulator");
  });

  it("still labels the vocabulary migration 294 wrote rather than rewriting those rows", () => {
    expect(visitorTypeLabel("family")).toBe("Family");
    expect(visitorTypeLabel("official")).toBe("Official or surveyor");
  });
});

describe("void reasons", () => {
  it("has operator wording and nothing free text", () => {
    expect(voidReasonLabel("entered_in_error")).toBe("Entered in error");
    expect(voidReasonLabel(null)).toBe("");
  });
});

describe("who can be visited", () => {
  it("is anyone holding a bed here, which is not the same as anyone on the roster", () => {
    expect([...VISITABLE_RESIDENT_STATUSES]).toEqual(["active", "hospital_hold", "loa"]);
    expect(VISITABLE_RESIDENT_STATUSES).not.toContain("discharged");
    expect(VISITABLE_RESIDENT_STATUSES).not.toContain("deceased");
  });
});
