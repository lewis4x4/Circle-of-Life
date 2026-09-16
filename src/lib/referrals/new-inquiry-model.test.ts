import { describe, expect, it } from "vitest";

import {
  buildCaptureInput,
  buildContactCommand,
  describeSaveError,
  emptyInquiryDraft,
  isInquiryDraftDirty,
  newRequestKey,
  OTHER_RELATIONSHIP,
  saveButtonLabel,
  saveStatusLine,
  validateInquiryDraft,
  type InquiryDraft,
} from "./new-inquiry-model";

const FACILITY = "11111111-1111-4111-8111-111111111111";

function draft(overrides: Partial<InquiryDraft> = {}): InquiryDraft {
  return {
    ...emptyInquiryDraft("2026-09-15"),
    residentFirstName: "Avery",
    residentLastName: "Resident",
    contactFirstName: "Jordan",
    contactLastName: "Caller",
    relationship: "Child",
    phone: "(555) 123-4567",
    referralSourceId: "src-1",
    ...overrides,
  };
}

describe("validateInquiryDraft", () => {
  it("accepts a third-party contact with a phone number", () => {
    expect(validateInquiryDraft(draft())).toEqual({ errors: {}, firstError: null });
  });

  it("requires the prospective resident's name and says whose name it is", () => {
    const { errors, firstError } = validateInquiryDraft(draft({ residentFirstName: " ", residentLastName: "" }));
    expect(errors.residentFirstName).toMatch(/prospective resident's first name/);
    expect(errors.residentLastName).toMatch(/prospective resident's last name/);
    expect(firstError).toBe("residentFirstName");
  });

  it("requires the contact's name and relationship unless the resident is the contact", () => {
    const missing = validateInquiryDraft(draft({ contactFirstName: "", contactLastName: "", relationship: "" }));
    expect(missing.errors.contactFirstName).toBeDefined();
    expect(missing.errors.contactLastName).toBeDefined();
    expect(missing.errors.relationship).toBeDefined();

    const self = validateInquiryDraft(
      draft({ residentIsContact: true, contactFirstName: "", contactLastName: "", relationship: "" }),
    );
    expect(self.errors).toEqual({});
  });

  it("requires a description when the relationship is Other", () => {
    expect(validateInquiryDraft(draft({ relationship: OTHER_RELATIONSHIP })).errors.relationshipOther).toBeDefined();
    expect(validateInquiryDraft(draft({ relationship: OTHER_RELATIONSHIP, relationshipOther: "Neighbor's daughter" })).errors).toEqual({});
  });

  it("accepts phone only or email only, and rejects neither", () => {
    expect(validateInquiryDraft(draft({ phone: "", email: "j@example.com" })).errors).toEqual({});
    expect(validateInquiryDraft(draft({ phone: "555", email: "" })).errors).toEqual({});
    const neither = validateInquiryDraft(draft({ phone: "", email: "" }));
    expect(neither.errors.phone).toBe("Provide a phone number or an email address.");
    expect(neither.errors.email).toBe("Provide a phone number or an email address.");
    expect(neither.firstError).toBe("phone");
  });

  it("rejects a malformed email", () => {
    expect(validateInquiryDraft(draft({ email: "not-an-email" })).errors.email).toBe("Enter a valid email address.");
  });

  it("only allows a channel preference when that channel was supplied", () => {
    expect(validateInquiryDraft(draft({ preference: "email", email: "" })).errors.preference).toMatch(/needs an email/);
    expect(validateInquiryDraft(draft({ preference: "phone", phone: "", email: "j@example.com" })).errors.preference).toMatch(/needs a phone/);
    expect(validateInquiryDraft(draft({ preference: "email", email: "j@example.com" })).errors).toEqual({});
  });

  it("requires a referral source unless it is marked not yet known", () => {
    expect(validateInquiryDraft(draft({ referralSourceId: "" })).errors.referralSourceId).toBeDefined();
    expect(validateInquiryDraft(draft({ referralSourceId: "", sourceNotYetKnown: true })).errors).toEqual({});
  });

  it("requires an inquiry date unless it is marked not known", () => {
    expect(validateInquiryDraft(draft({ inquiryDate: "" })).errors.inquiryDate).toBeDefined();
    expect(validateInquiryDraft(draft({ inquiryDate: "9/15" })).errors.inquiryDate).toBe("Enter a complete date.");
    expect(validateInquiryDraft(draft({ inquiryDate: "", inquiryDateNotKnown: true })).errors).toEqual({});
  });
});

describe("buildCaptureInput", () => {
  it("puts phone and email on the lead only when the resident is the contact", () => {
    const self = buildCaptureInput(draft({ residentIsContact: true, email: "a@example.com" }), FACILITY, "inquiry:k1");
    expect(self).toMatchObject({
      requestKey: "inquiry:k1",
      facilityId: FACILITY,
      firstName: "Avery",
      lastName: "Resident",
      phone: "(555) 123-4567",
      email: "a@example.com",
      preferredContact: "either",
      referralSourceId: "src-1",
      receipt: { precision: "date", date: "2026-09-15" },
    });

    const third = buildCaptureInput(draft(), FACILITY, "inquiry:k1");
    expect(third.phone).toBeNull();
    expect(third.email).toBeNull();
  });

  it("stores an unknown source as null and an unknown date as unknown precision", () => {
    const input = buildCaptureInput(
      draft({ referralSourceId: "", sourceNotYetKnown: true, inquiryDate: "", inquiryDateNotKnown: true }),
      FACILITY,
      "inquiry:k2",
    );
    expect(input.referralSourceId).toBeNull();
    expect(input.receipt).toEqual({ precision: "unknown" });
  });
});

describe("buildContactCommand", () => {
  it("links the caller as the primary contact with their relationship", () => {
    expect(buildContactCommand(draft({ email: "j@example.com" }))).toEqual({
      kind: "contact_add",
      first_name: "Jordan",
      last_name: "Caller",
      relationship: "Child",
      phone: "(555) 123-4567",
      email: "j@example.com",
      is_primary: true,
    });
  });

  it("uses the free-text relationship for Other and returns null when the resident is the contact", () => {
    expect(buildContactCommand(draft({ relationship: OTHER_RELATIONSHIP, relationshipOther: " Pastor " }))?.relationship).toBe("Pastor");
    expect(buildContactCommand(draft({ residentIsContact: true }))).toBeNull();
  });
});

describe("dirty tracking and copy", () => {
  it("does not count the default inquiry date as work", () => {
    const initial = emptyInquiryDraft("2026-09-15");
    expect(isInquiryDraftDirty({ ...initial }, initial)).toBe(false);
    expect(isInquiryDraftDirty({ ...initial, residentFirstName: "A" }, initial)).toBe(true);
    expect(isInquiryDraftDirty({ ...initial, inquiryDate: "2026-09-14" }, initial)).toBe(true);
  });

  it("labels the save control by what is still unsaved", () => {
    expect(saveButtonLabel({ step: "idle" }, false)).toBe("Save lead");
    expect(saveButtonLabel({ step: "saving_lead" }, true)).toBe("Saving…");
    expect(saveButtonLabel({ step: "lead_saved", leadId: "l", revision: "r", contactPending: true }, false)).toBe("Save contact");
    expect(saveButtonLabel({ step: "saving_contact", leadId: "l", revision: "r" }, true)).toBe("Saving contact…");
    expect(saveStatusLine({ step: "idle" }, true)).toBe("Your changes have not been saved.");
    expect(saveStatusLine({ step: "lead_saved", leadId: "l", revision: "r", contactPending: true }, true)).toMatch(/contact has not been recorded/);
  });

  it("translates authority errors into operator copy and keeps unknown messages", () => {
    expect(describeSaveError(new Error("Referral write authority required"), "x")).toMatch(/write access/);
    expect(describeSaveError(new Error("Referral opportunity changed; reload before saving"), "x")).toMatch(/changed elsewhere/);
    expect(describeSaveError(new TypeError("Failed to fetch"), "x")).toMatch(/could not be reached/);
    expect(describeSaveError(new Error("Something specific"), "x")).toBe("Something specific");
    expect(describeSaveError(null, "fallback")).toBe("fallback");
  });

  it("mints distinct request keys", () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).toMatch(/^inquiry:/);
    expect(a).not.toBe(b);
  });
});
