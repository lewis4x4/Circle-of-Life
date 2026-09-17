/**
 * The front desk visitor log.
 *
 * Staff operated: somebody at the desk signs a visitor in and out. There is no
 * self service kiosk here, and no free text field — a notes box on a log that
 * every aide can read is how a resident's health details end up on a visitor
 * record. Nothing is ever corrected in place: a wrong entry is voided with a
 * coded reason and stays visible.
 */

export const VISITOR_TYPES = [
  { id: "family_friend", label: "Family or friend" },
  { id: "healthcare_provider", label: "Healthcare provider" },
  { id: "vendor_contractor", label: "Vendor or contractor" },
  { id: "surveyor_regulator", label: "Surveyor or regulator" },
  { id: "other", label: "Other" },
] as const;

export type VisitorTypeId = (typeof VISITOR_TYPES)[number]["id"];

/**
 * Migration 294 shipped its own vocabulary and those rows are still in the
 * table. They are labelled rather than rewritten, because relabelling somebody
 * else's record after the fact is exactly what this log is supposed to prevent.
 */
const LEGACY_VISITOR_TYPE_LABELS: Record<string, string> = {
  family: "Family",
  vendor: "Vendor",
  contractor: "Contractor",
  medical: "Medical",
  official: "Official or surveyor",
};

export function visitorTypeLabel(id: string): string {
  const current = VISITOR_TYPES.find((type) => type.id === id);
  if (current) return current.label;
  return LEGACY_VISITOR_TYPE_LABELS[id] ?? id.replace(/_/g, " ");
}

export const VISITING_TYPES = [
  { id: "resident", label: "Resident" },
  { id: "staff", label: "Staff" },
  { id: "facility", label: "Facility" },
] as const;

export type VisitingTypeId = (typeof VISITING_TYPES)[number]["id"];

export const VOID_REASONS = [
  { id: "entered_in_error", label: "Entered in error" },
  { id: "duplicate", label: "Duplicate" },
  { id: "wrong_facility", label: "Wrong facility" },
] as const;

export type VoidReasonId = (typeof VOID_REASONS)[number]["id"];

export function voidReasonLabel(id: string | null): string {
  if (!id) return "";
  return VOID_REASONS.find((reason) => reason.id === id)?.label ?? id.replace(/_/g, " ");
}

/** The statuses that mean a resident can be visited: they hold a bed here. */
export const VISITABLE_RESIDENT_STATUSES = ["active", "hospital_hold", "loa"] as const;

export type VisitorLogRow = {
  id: string;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: string;
  visitingType: string | null;
  visitingResidentId: string | null;
  visitingResidentName: string | null;
  signedInAt: string;
  signedInByName: string | null;
  signedOutAt: string | null;
  signedOutByName: string | null;
  signOutMethod: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  leftOpen: boolean;
};

export type VisitorSignInDraft = {
  name: string;
  phone: string;
  visitorType: VisitorTypeId;
  visitingType: VisitingTypeId;
  residentId: string;
};

export const EMPTY_VISITOR_DRAFT: VisitorSignInDraft = {
  name: "",
  phone: "",
  visitorType: "family_friend",
  visitingType: "resident",
  residentId: "",
};

const PHONE_RE = /^[0-9()+\-. ]{7,20}$/;

/** What the desk still has to supply. Nothing is defaulted on their behalf. */
export function validateVisitorSignIn(draft: VisitorSignInDraft): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (!name) problems.push("Enter the visitor's name.");
  else if (name.length > 120) problems.push("The visitor's name is too long for the log.");
  if (draft.phone.trim() && !PHONE_RE.test(draft.phone.trim())) {
    problems.push("Enter the phone number as digits, spaces and dashes.");
  }
  if (draft.visitingType === "resident" && !draft.residentId) {
    problems.push("Choose the resident being visited.");
  }
  return problems;
}

/** In the building now: open, not voided, oldest first so the longest stay leads. */
export function inTheBuildingNow(rows: VisitorLogRow[]): VisitorLogRow[] {
  return rows
    .filter((row) => !row.signedOutAt && !row.voidedAt)
    .sort((a, b) => a.signedInAt.localeCompare(b.signedInAt));
}

export function openVisitorCount(rows: VisitorLogRow[]): number {
  return inTheBuildingNow(rows).length;
}

/**
 * How many the bulk action would close, so the confirmation can say a number
 * rather than ask the desk to trust it.
 */
export function signOutEveryoneConfirmation(count: number): string {
  if (count === 1) return "Sign out the 1 visitor still in the building?";
  return `Sign out all ${count} visitors still in the building?`;
}

export const VISITOR_LOG_EMPTY_COPY = "Nobody is signed in right now.";
export const VISITOR_LOG_RANGE_EMPTY_COPY = "No visitors signed in for this range.";
