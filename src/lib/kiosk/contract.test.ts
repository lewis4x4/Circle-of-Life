import { describe, expect, it } from "vitest";

import { KIOSK_KINDS, KIOSK_SICK_QUESTION, KIOSK_VISITOR_COPY, KIOSK_VISITOR_TYPE, kioskPrefixLetterCount, validateKioskSignIn } from "./contract";

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

  it("never offers a resident picker: who they visit is typed text", () => {
    for (const kind of Object.values(KIOSK_KINDS)) {
      expect(kind.fields.map((f) => f.name)).not.toContain("resident_id");
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
    expect(KIOSK_VISITOR_COPY.signOutHint).toBe("Type the first 3 letters of your first name");
  });

  it("says what is missing in plain words", () => {
    const result = validateKioskSignIn("visitor", { name: "", visiting_name: "", symptoms: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: "Enter your name.",
        visiting_name: "Enter the name of the person you are visiting.",
        symptoms: "Choose Yes or No.",
      });
    }
  });
});

describe("validateKioskSignIn", () => {
  it("trims and normalizes a valid visit", () => {
    expect(validateKioskSignIn("visitor", { name: " Jordan Visitor ", phone: " 555-0100 ", visiting_name: "Test Resident", symptoms: true })).toEqual({
      ok: true,
      value: { visitor_type: "family_friend", name: "Jordan Visitor", phone: "555-0100", company: null, visiting_name: "Test Resident", purpose: null, symptoms: true },
    });
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
