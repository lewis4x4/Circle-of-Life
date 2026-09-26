import { describe, expect, it } from "vitest";

import {
  KIOSK_KINDS,
  KIOSK_SICK_QUESTION,
  KIOSK_VISITOR_COPY,
  KIOSK_VISITOR_TYPE,
  kioskPrefixLetterCount,
  kioskResidentPickedLabel,
  kioskRoomLabel,
  validateKioskSignIn,
} from "./contract";

const RESIDENT = "84ad69f3-911e-4069-9b4f-24aebe591a79";

describe("kiosk visitor kinds (spec 40 §7)", () => {
  it("maps each kiosk kind to its visitor_type", () => {
    expect(KIOSK_VISITOR_TYPE).toEqual({
      visitor: "family_friend",
      provider: "healthcare_provider",
      vendor: "vendor_contractor",
      inspector: "surveyor_regulator",
    });
  });

  it("asks the sick-today question only on the visit and provider forms", () => {
    const asks = Object.values(KIOSK_KINDS).filter((k) => k.fields.some((f) => f.name === "symptoms")).map((k) => k.kind);
    expect(asks).toEqual(["visitor", "provider"]);
  });

  it("asks who they are seeing on the visit (required) and provider (optional) forms only", () => {
    const asks = Object.values(KIOSK_KINDS).flatMap((k) => k.fields.filter((f) => f.name === "visiting_name").map((f) => [k.kind, f.required]));
    expect(asks).toEqual([
      ["visitor", true],
      ["provider", false],
    ]);
    for (const kind of ["visitor", "provider"] as const) {
      expect(KIOSK_KINDS[kind].fields.find((f) => f.name === "visiting_name")).toMatchObject({
        label: "Resident you are seeing",
        placeholder: "Start typing their first or last name",
      });
    }
  });
});

describe("kiosk copy is the approved prototype's (DESIGN §1, one source for screen and route)", () => {
  it("uses the rendered card titles and subtitles", () => {
    expect(Object.values(KIOSK_KINDS).map((k) => [k.title, k.subtitle])).toEqual([
      ["Visiting a resident", "Family and friends"],
      ["Healthcare provider", "Doctors, nurses, hospice, home health, therapy"],
      ["Vendor or contractor", "Deliveries, repairs, service"],
      ["Inspector or official", "AHCA surveyors, fire marshal"],
    ]);
    expect(KIOSK_KINDS.visitor.formSubtitle).toBe("Sign in so staff know you are in the building.");
    expect(KIOSK_KINDS.provider.formSubtitle).toBe("Doctors, nurses, hospice, home health and therapy sign in here.");
  });

  it("asks the rendered sick question and labels phone as optional by placeholder", () => {
    for (const kind of ["visitor", "provider"] as const) {
      expect(KIOSK_KINDS[kind].fields.find((f) => f.name === "symptoms")?.label).toBe(KIOSK_SICK_QUESTION);
    }
    expect(KIOSK_SICK_QUESTION).toBe("Do you have a fever, cough or feel sick today?");
    expect(KIOSK_KINDS.visitor.fields.find((f) => f.name === "phone")).toMatchObject({ label: "Phone", placeholder: "Optional" });
    expect(KIOSK_VISITOR_COPY.visitorLogLine).toBe("Your name and times go in the facility visitor log.");
    expect(KIOSK_VISITOR_COPY.signOutPrompt).toBe("Leaving? Sign out");
    expect(Object.values(KIOSK_VISITOR_COPY.signOutReminder).join("")).toBe("When you leave, tap Sign out on the home screen.");
  });

  it("says what is missing in plain words", () => {
    const result = validateKioskSignIn("visitor", { name: "", visiting_name: "", symptoms: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: "Enter your name.",
        visiting_name: "Pick the resident you are seeing, or tap Not listed.",
        symptoms: "Choose Yes or No.",
      });
    }
  });
});

describe("validateKioskSignIn", () => {
  it("trims and normalizes a valid visit", () => {
    expect(validateKioskSignIn("visitor", { name: " Jordan Visitor ", phone: " 555-0100 ", visiting_name: "Test Resident", symptoms: true })).toEqual({
      ok: true,
      value: { visitor_type: "family_friend", name: "Jordan Visitor", phone: "555-0100", company: null, visiting_name: "Test Resident", purpose: null, symptoms: true, resident_id: null },
    });
  });

  it("takes a picked resident in place of a typed name, never both, and only where the form asks", () => {
    const picked = validateKioskSignIn("visitor", { name: "A B", resident_id: RESIDENT, symptoms: false });
    expect(picked).toMatchObject({ ok: true, value: { resident_id: RESIDENT, visiting_name: null } });
    expect(validateKioskSignIn("provider", { name: "A B", company: "C", resident_id: RESIDENT, symptoms: false }).ok).toBe(true);
    const both = validateKioskSignIn("visitor", { name: "A B", resident_id: RESIDENT, visiting_name: "Typed", symptoms: false });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.errors.visiting_name).toBe("Pick the resident or type their name, not both.");
    expect(validateKioskSignIn("vendor", { name: "A B", company: "C", resident_id: RESIDENT }).ok).toBe(false);
    expect(validateKioskSignIn("visitor", { name: "A B", resident_id: "not-a-uuid", symptoms: false }).ok).toBe(false);
  });

  it("requires company for providers, vendors and inspectors, and refuses it for a family visit", () => {
    for (const kind of ["provider", "vendor", "inspector"] as const) {
      const result = validateKioskSignIn(kind, { name: "A B", symptoms: false });
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.errors.company, kind).toBeTruthy();
    }
    const family = validateKioskSignIn("visitor", { name: "A B", company: "X", visiting_name: "R", symptoms: false });
    expect(family.ok).toBe(false);
  });

  it("refuses a symptom answer on forms that do not ask it, and requires one where they do", () => {
    expect(validateKioskSignIn("vendor", { name: "A", company: "C", symptoms: true }).ok).toBe(false);
    expect(validateKioskSignIn("provider", { name: "A", company: "C" }).ok).toBe(false);
  });

  it("enforces the database lengths and phone pattern", () => {
    expect(validateKioskSignIn("inspector", { name: "x".repeat(121), company: "C" }).ok).toBe(false);
    expect(validateKioskSignIn("vendor", { name: "A", company: "C", purpose: "p".repeat(281) }).ok).toBe(false);
    expect(validateKioskSignIn("visitor", { name: "A", phone: "12", visiting_name: "R", symptoms: false }).ok).toBe(false);
  });
});

describe("kioskPrefixLetterCount", () => {
  it("counts letters only, like the database", () => {
    expect(kioskPrefixLetterCount("Jo")).toBe(2);
    expect(kioskPrefixLetterCount("J-o 1")).toBe(2);
    expect(kioskPrefixLetterCount("José")).toBe(4);
  });
});

describe("resident picker labels", () => {
  it("reads Room 12 and Martha J. · Room 12, and leaves the room off when there is none", () => {
    expect(kioskRoomLabel("12")).toBe("Room 12");
    expect(kioskRoomLabel(null)).toBe("");
    expect(kioskResidentPickedLabel({ resident_id: RESIDENT, display_name: "Martha J.", room: "12" })).toBe("Martha J. · Room 12");
    expect(kioskResidentPickedLabel({ resident_id: RESIDENT, display_name: "Martha J.", room: null })).toBe("Martha J.");
  });
});
