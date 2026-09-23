/**
 * The front desk visitor log.
 *
 * Staff sign visitors in and out at the desk, and visitors sign themselves in
 * at the front-door kiosk (COL-692), where they type who they are seeing and
 * the desk matches it to the resident afterwards. There is no notes box — a
 * notes box on a log that every aide can read is how a resident's health
 * details end up on a visitor record. Nothing is ever corrected in place: a wrong entry is voided with a
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
  /** Kiosk entries (COL-692): company or agency, and the resident name as typed at the door. */
  visitorCompany?: string | null;
  visitingNameText?: string | null;
  fromKiosk?: boolean;
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

/** "Carol Parker" or, for a provider, vendor or inspector, "Dana Reyes · Sunshine Hospice". */
export function visitorDisplayName(row: VisitorLogRow): string {
  return row.visitorCompany ? `${row.visitorName} · ${row.visitorCompany}` : row.visitorName;
}

/** Who the visit was for: the matched resident, else what the visitor typed at the kiosk. */
export function visitingDisplay(row: VisitorLogRow): string {
  if (row.visitingResidentName) return row.visitingResidentName;
  if (row.visitingNameText) return `${row.visitingNameText} (typed at the kiosk)`;
  return row.visitingType ?? "";
}

/** Who signed the entry in: the staff member, or the kiosk for a self sign-in. */
export function signedInByDisplay(row: VisitorLogRow): string {
  return row.signedInByName ?? (row.fromKiosk ? "Front-door kiosk" : "");
}

/** A kiosk entry whose typed resident the desk has not matched yet (visitor_match_resident). */
export function needsResidentMatch(row: VisitorLogRow): boolean {
  return Boolean(row.fromKiosk && row.visitingNameText && !row.visitingResidentId && !row.voidedAt);
}

export const VISITOR_LOG_EMPTY_COPY = "Nobody is signed in right now.";
export const VISITOR_LOG_RANGE_EMPTY_COPY = "No visitors signed in for this range.";
