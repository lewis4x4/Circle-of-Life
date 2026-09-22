import { describe, expect, it } from "vitest";

import {
  RESPONSIBLE_PARTY_CONTACT_ID,
  RESPONSIBLE_PARTY_CONTACT_NOTE,
  responsiblePartyContact,
} from "./resident-responsible-party";

const source = (over: Partial<Parameters<typeof responsiblePartyContact>[0]> = {}) => ({
  responsiblePartyName: "Karon Hegland",
  responsiblePartyRelationship: "Daughter",
  responsiblePartyPhone: "202-555-0116",
  responsiblePartyEmail: null,
  ...over,
});

describe("responsible party as a care contact", () => {
  it("offers the responsible party the resident record already holds", () => {
    const result = responsiblePartyContact(source());
    expect(result?.row.name).toBe("Karon Hegland");
    expect(result?.row.relationship).toBe("Daughter");
    expect(result?.row.phone).toBe("202-555-0116");
    expect(result?.row.isEmergencyContact).toBe(true);
  });

  // A phone number with nobody attached is not a contact: there is no one to ask for.
  it("returns nothing when the record holds no name", () => {
    expect(responsiblePartyContact(source({ responsiblePartyName: null }))).toBeNull();
    expect(responsiblePartyContact(source({ responsiblePartyName: "   " }))).toBeNull();
  });

  it("keeps a missing relationship, phone or email null rather than blank", () => {
    const result = responsiblePartyContact(
      source({ responsiblePartyRelationship: "  ", responsiblePartyPhone: "", responsiblePartyEmail: " " }),
    );
    expect(result?.row.relationship).toBeNull();
    expect(result?.row.phone).toBeNull();
    expect(result?.email).toBeNull();
  });

  // No contact row means nobody has maintained a "last contact" date. Inventing
  // one would read as a contact that was made.
  it("never claims a last-contact date", () => {
    expect(responsiblePartyContact(source())?.row.updatedAt).toBeNull();
  });

  it("says where it came from, so it reads as something to promote rather than a maintained contact", () => {
    expect(responsiblePartyContact(source())?.note).toBe(RESPONSIBLE_PARTY_CONTACT_NOTE);
    expect(RESPONSIBLE_PARTY_CONTACT_NOTE).toMatch(/not yet a care contact/);
  });

  // Nothing may ever write against this id — it is not a resident_contacts row.
  it("carries a synthetic id that sorts behind every real contact", () => {
    const result = responsiblePartyContact(source());
    expect(result?.row.id).toBe(RESPONSIBLE_PARTY_CONTACT_ID);
    expect(result?.row.sortOrder).toBe(Number.MAX_SAFE_INTEGER);
  });
});
