import { describe, expect, it } from "vitest";

import { KIOSK_KINDS, KIOSK_VISITOR_TYPE, kioskPrefixLetterCount, validateKioskSignIn } from "./contract";

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
