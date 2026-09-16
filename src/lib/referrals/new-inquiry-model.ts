/**
 * New referral lead (initial inquiry) — form model.
 *
 * Three different people can be behind one inquiry: the prospective resident,
 * the person contacting the facility, and a professional referrer. The stored
 * model keeps them apart — `referral_leads.first_name/last_name` (and the
 * `referral_people` row behind them) are the prospective resident; a caller who
 * is somebody else is a `referral_contacts` row linked with a relationship —
 * and this module keeps the form honest about which is which.
 *
 * Everything here is pure so the page can be thin and the rules testable.
 */

import type { Database } from "@/types/database";
import type { ReferralEffectiveValue, ReferralEpisodeCommand } from "@/lib/referrals/referral-authority";

export type ContactPreference = Database["public"]["Enums"]["referral_lead_preferred_contact"];

export type InquiryDraft = {
  residentFirstName: string;
  residentLastName: string;
  /** The prospective resident is the person to call back. */
  residentIsContact: boolean;
  contactFirstName: string;
  contactLastName: string;
  /** One of RELATIONSHIP_OPTIONS, or "" when not chosen. */
  relationship: string;
  /** Free text when relationship is OTHER_RELATIONSHIP. */
  relationshipOther: string;
  phone: string;
  email: string;
  preference: ContactPreference;
  referralSourceId: string;
  sourceNotYetKnown: boolean;
  /** YYYY-MM-DD in the facility's day. */
  inquiryDate: string;
  inquiryDateNotKnown: boolean;
};

export type InquiryField = keyof InquiryDraft;

export const OTHER_RELATIONSHIP = "Other";

/** Stored as free text on `referral_person_contacts.relationship`; this list is a convenience, not a vocabulary rule. */
export const RELATIONSHIP_OPTIONS = [
  "Child",
  "Spouse or partner",
  "Sibling",
  "Other relative",
  "Friend or neighbor",
  "Guardian or power of attorney",
  "Case manager or discharge planner",
  "Physician or provider",
  OTHER_RELATIONSHIP,
] as const;

/**
 * The stored enum has no "not recorded" value; `either` is its neutral member
 * and is what the compatibility path always wrote. The form names that
 * honestly rather than pre-selecting a channel nobody stated.
 */
export const PREFERENCE_OPTIONS: ReadonlyArray<{ value: ContactPreference; label: string }> = [
  { value: "either", label: "No preference recorded" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

export const PREFERENCE_NOT_PERMISSION_COPY =
  "A preference is how they asked to be reached. It is not permission to contact them; permissions are recorded separately.";

export const CLINICAL_LATER_COPY = "Clinical information is entered later by authorized staff.";

export const CONTACT_METHOD_COPY = "Provide a phone number or an email address.";

export function emptyInquiryDraft(inquiryDate: string): InquiryDraft {
  return {
    residentFirstName: "",
    residentLastName: "",
    residentIsContact: false,
    contactFirstName: "",
    contactLastName: "",
    relationship: "",
    relationshipOther: "",
    phone: "",
    email: "",
    preference: "either",
    referralSourceId: "",
    sourceNotYetKnown: false,
    inquiryDate,
    inquiryDateNotKnown: false,
  };
}

/** Fields whose values an operator typed; the default inquiry date alone is not "work". */
export function isInquiryDraftDirty(draft: InquiryDraft, initial: InquiryDraft): boolean {
  return (Object.keys(draft) as InquiryField[]).some((key) => key !== "inquiryDate" && draft[key] !== initial[key])
    || (draft.inquiryDate !== initial.inquiryDate);
}

export function emailLooksValid(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type InquiryErrors = Partial<Record<InquiryField, string>>;

/** Field order used to focus the first problem after an attempted save. */
export const FIELD_ORDER: InquiryField[] = [
  "residentFirstName",
  "residentLastName",
  "contactFirstName",
  "contactLastName",
  "relationship",
  "relationshipOther",
  "phone",
  "email",
  "preference",
  "referralSourceId",
  "inquiryDate",
];

export function validateInquiryDraft(draft: InquiryDraft): { errors: InquiryErrors; firstError: InquiryField | null } {
  const errors: InquiryErrors = {};

  if (!draft.residentFirstName.trim()) errors.residentFirstName = "Enter the prospective resident's first name.";
  if (!draft.residentLastName.trim()) errors.residentLastName = "Enter the prospective resident's last name.";

  if (!draft.residentIsContact) {
    if (!draft.contactFirstName.trim()) errors.contactFirstName = "Enter the contact's first name.";
    if (!draft.contactLastName.trim()) errors.contactLastName = "Enter the contact's last name.";
    if (!draft.relationship) errors.relationship = "Choose how the contact is related to the prospective resident.";
    else if (draft.relationship === OTHER_RELATIONSHIP && !draft.relationshipOther.trim()) {
      errors.relationshipOther = "Describe the relationship.";
    }
  }

  const phone = draft.phone.trim();
  const email = draft.email.trim();
  if (!phone && !email) {
    errors.phone = CONTACT_METHOD_COPY;
    errors.email = CONTACT_METHOD_COPY;
  }
  if (email && !emailLooksValid(email)) errors.email = "Enter a valid email address.";

  if (draft.preference === "phone" && !phone) errors.preference = "A phone preference needs a phone number.";
  if (draft.preference === "email" && !email) errors.preference = "An email preference needs an email address.";

  if (!draft.sourceNotYetKnown && !draft.referralSourceId) {
    errors.referralSourceId = "Choose a referral source, or mark it as not yet known.";
  }

  if (!draft.inquiryDateNotKnown) {
    if (!draft.inquiryDate.trim()) errors.inquiryDate = "Enter the inquiry date, or mark it as not known.";
    else if (!ISO_DATE_RE.test(draft.inquiryDate.trim())) errors.inquiryDate = "Enter a complete date.";
  }

  const firstError = FIELD_ORDER.find((field) => errors[field]) ?? null;
  return { errors, firstError };
}

export function relationshipText(draft: InquiryDraft): string {
  if (draft.relationship === OTHER_RELATIONSHIP) return draft.relationshipOther.trim();
  return draft.relationship;
}

export function receiptValue(draft: InquiryDraft): ReferralEffectiveValue {
  if (draft.inquiryDateNotKnown) return { precision: "unknown" };
  return { precision: "date", date: draft.inquiryDate.trim() };
}

export type CaptureInput = {
  requestKey: string;
  facilityId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  preferredContact: ContactPreference;
  referralSourceId: string | null;
  receipt: ReferralEffectiveValue;
};

/**
 * The lead's own phone/email belong to the prospective resident. When somebody
 * else is the contact, their details go on the contact record instead, so a
 * caller's number is never stored as if it were the resident's.
 */
export function buildCaptureInput(draft: InquiryDraft, facilityId: string, requestKey: string): CaptureInput {
  const phone = draft.phone.trim() || null;
  const email = draft.email.trim() || null;
  return {
    requestKey,
    facilityId,
    firstName: draft.residentFirstName.trim(),
    lastName: draft.residentLastName.trim(),
    phone: draft.residentIsContact ? phone : null,
    email: draft.residentIsContact ? email : null,
    preferredContact: draft.preference,
    referralSourceId: draft.sourceNotYetKnown ? null : draft.referralSourceId || null,
    receipt: receiptValue(draft),
  };
}

/** The primary contact to link after capture, or null when the resident is the contact. */
export function buildContactCommand(draft: InquiryDraft): Extract<ReferralEpisodeCommand, { kind: "contact_add" }> | null {
  if (draft.residentIsContact) return null;
  return {
    kind: "contact_add",
    first_name: draft.contactFirstName.trim(),
    last_name: draft.contactLastName.trim(),
    relationship: relationshipText(draft),
    phone: draft.phone.trim() || null,
    email: draft.email.trim() || null,
    is_primary: true,
  };
}

/** One key per attempt at one record, so a retry replays instead of creating a second lead. */
export function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `inquiry:${crypto.randomUUID()}`;
  }
  return `inquiry:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type SaveProgress =
  | { step: "idle" }
  | { step: "saving_lead" }
  | { step: "lead_saved"; leadId: string; revision: string; contactPending: boolean }
  | { step: "saving_contact"; leadId: string; revision: string }
  | { step: "done"; leadId: string };

export function saveButtonLabel(progress: SaveProgress, saving: boolean): string {
  if (saving) return progress.step === "saving_contact" ? "Saving contact…" : "Saving…";
  if (progress.step === "lead_saved" && progress.contactPending) return "Save contact";
  return "Save lead";
}

export function saveStatusLine(progress: SaveProgress, dirty: boolean): string {
  switch (progress.step) {
    case "lead_saved":
      return progress.contactPending
        ? "The lead is saved. The primary contact has not been recorded yet."
        : "Lead saved.";
    case "saving_lead":
    case "saving_contact":
      return "Saving…";
    case "done":
      return "Lead saved.";
    default:
      return dirty ? "Your changes have not been saved." : "Nothing entered yet.";
  }
}

/** Operator copy for the errors the referral authority raises. */
export function describeSaveError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/write authority required|write scope unavailable/i.test(message)) {
    return "You do not have referral write access for this facility.";
  }
  if (/changed; reload before saving|requires the empty revision/i.test(message)) {
    return "This lead changed elsewhere. Open it from the pipeline before continuing.";
  }
  if (/request key/i.test(message) && /payload|conflict/i.test(message)) {
    return "This save was already attempted with different details. Reload the page to start a new lead.";
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return "Haven could not be reached. Your entries are kept; try again when you are back online.";
  }
  return message || fallback;
}

export const LEAD_SAVE_FAILED_COPY = "The lead could not be saved. Your entries are kept.";
export const CONTACT_SAVE_FAILED_COPY =
  "The lead was saved, but the primary contact was not recorded. Try again to record the contact.";
