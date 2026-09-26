/**
 * Front-door kiosk contract (COL-692, spec 40 §7). Shared by the /kiosk pages
 * and the /api/kiosk/visitor/* route handlers. Client-safe.
 *
 * The kiosk is one enrolled device of kind `kiosk`: its token lives in the
 * timeclock kiosk store (`src/lib/timeclock/kiosk-store.ts`, IndexedDB
 * `haven-timeclock`) and rides in `KIOSK_DEVICE_HEADER` for staff punches and
 * visitor calls alike. `/kiosk/setup` enrolls through the existing kiosk
 * enroll route, which only accepts kiosk-kind codes.
 *
 * No resident is ever listed in full. The visitor types three letters and picks
 * from at most six current residents (`visitor_kiosk_resident_matches`), or
 * types the name and the front desk matches it later.
 */

export { KIOSK_DEVICE_HEADER, KIOSK_ENROLL_ENDPOINT as KIOSK_SETUP_ENDPOINT } from "@/lib/timeclock/kiosk-contract";

export const KIOSK_VISITOR_SIGN_IN_ENDPOINT = "/api/kiosk/visitor/sign-in";
export const KIOSK_VISITOR_OPEN_ENDPOINT = "/api/kiosk/visitor/open";
export const KIOSK_VISITOR_SIGN_OUT_ENDPOINT = "/api/kiosk/visitor/sign-out";
export const KIOSK_VISITOR_RESIDENTS_ENDPOINT = "/api/kiosk/visitor/residents";

/** Any kiosk screen returns home after this long without input. */
export const KIOSK_IDLE_RESET_MS = 30_000;
/** Confirmations return home after this long. */
export const KIOSK_CONFIRM_RESET_MS = 5_000;
/** Sign-out lists nothing before this many letters. */
export const KIOSK_SIGN_OUT_MIN_LETTERS = 3;
/** Sign-out lists at most this many open visits. */
export const KIOSK_SIGN_OUT_MAX_MATCHES = 5;
/** The sign-out screen returns home after this long without input. */
export const KIOSK_SIGN_OUT_IDLE_MS = 60_000;
/** The resident picker asks nothing before this many letters. */
export const KIOSK_RESIDENT_MIN_LETTERS = 3;
/** The resident picker shows at most this many residents. */
export const KIOSK_RESIDENT_MAX_MATCHES = 6;
/** Wait this long after the last letter before asking, so typing "Carol" is one request, not five. */
export const KIOSK_SEARCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Visitor kinds and their fields
// ---------------------------------------------------------------------------

/** URL segment for `/kiosk/sign-in/[kind]`. */
export const KIOSK_VISITOR_KINDS = ["visitor", "provider", "vendor", "inspector"] as const;
export type KioskVisitorKind = (typeof KIOSK_VISITOR_KINDS)[number];

export function isKioskVisitorKind(value: unknown): value is KioskVisitorKind {
  return typeof value === "string" && (KIOSK_VISITOR_KINDS as readonly string[]).includes(value);
}

/** `visitor_log_entries.visitor_type` for each kind. */
export const KIOSK_VISITOR_TYPE: Record<KioskVisitorKind, "family_friend" | "healthcare_provider" | "vendor_contractor" | "surveyor_regulator"> = {
  visitor: "family_friend",
  provider: "healthcare_provider",
  vendor: "vendor_contractor",
  inspector: "surveyor_regulator",
};

export type KioskFieldName = "name" | "phone" | "company" | "visiting_name" | "purpose" | "symptoms";

export type KioskFieldRule = {
  name: KioskFieldName;
  label: string;
  required: boolean;
  placeholder?: string;
  hint?: string;
  /** The error when a required field is empty; defaults to "Enter <label>." */
  missing?: string;
  /** Show "(required)" after the label, as the provider form does for its agency. */
  markRequired?: boolean;
};

export type KioskKindDefinition = {
  kind: KioskVisitorKind;
  title: string;
  /** Under the title on the home card. */
  subtitle: string;
  /** The line under the form's header. */
  formSubtitle: string;
  /** Fields in form order. A field not listed must be empty for this kind. */
  fields: KioskFieldRule[];
};

/** Asked on the visit and provider forms; "Yes" records screening_passed = false. */
export const KIOSK_SICK_QUESTION = "Do you have a fever, cough or feel sick today?";

const NAME_FIELD: KioskFieldRule = { name: "name", label: "Your name", required: true, placeholder: "First and last name", missing: "Enter your name." };
const SYMPTOMS_FIELD: KioskFieldRule = { name: "symptoms", label: KIOSK_SICK_QUESTION, required: true, missing: "Choose Yes or No." };
/** The resident field: a picker over current residents, or a typed name behind "Not listed?". */
const RESIDENT_FIELD = { name: "visiting_name", label: "Resident you are seeing", placeholder: "Start typing their first or last name" } as const;

/**
 * Spec 40 §7 field table, in the approved prototype's words
 * (`docs/designs/floor-tablet-kiosk/reference/10`, `14`, `15`). The database
 * (`visitor_kiosk_sign_in`) enforces the same rules; the route checks them
 * first so the kiosk gets field errors.
 */
export const KIOSK_KINDS: Record<KioskVisitorKind, KioskKindDefinition> = {
  visitor: {
    kind: "visitor",
    title: "Visiting a resident",
    subtitle: "Family and friends",
    formSubtitle: "Sign in so staff know you are in the building.",
    fields: [
      NAME_FIELD,
      { name: "phone", label: "Phone", required: false, placeholder: "Optional", hint: "Only used if the building needs to reach you." },
      { ...RESIDENT_FIELD, required: true, missing: "Pick the resident you are seeing, or tap Not listed." },
      SYMPTOMS_FIELD,
    ],
  },
  provider: {
    kind: "provider",
    title: "Healthcare provider",
    subtitle: "Doctors, nurses, hospice, home health, therapy",
    formSubtitle: "Doctors, nurses, hospice, home health and therapy sign in here.",
    fields: [
      NAME_FIELD,
      { name: "company", label: "Agency or practice", required: true, markRequired: true, placeholder: "Hospice, home health, physician office" },
      { ...RESIDENT_FIELD, required: false },
      SYMPTOMS_FIELD,
    ],
  },
  vendor: {
    kind: "vendor",
    title: "Vendor or contractor",
    subtitle: "Deliveries, repairs, service",
    formSubtitle: "Deliveries, repairs and service sign in here.",
    fields: [
      NAME_FIELD,
      { name: "company", label: "Company", required: true, markRequired: true, placeholder: "Company name" },
      { name: "purpose", label: "What are you here for?", required: false, placeholder: "Delivery, repair or service" },
    ],
  },
  inspector: {
    kind: "inspector",
    title: "Inspector or official",
    subtitle: "AHCA surveyors, fire marshal",
    formSubtitle: "Surveyors, fire marshals and other officials sign in here.",
    fields: [NAME_FIELD, { name: "company", label: "Agency", required: true, markRequired: true, placeholder: "AHCA, fire marshal, county" }],
  },
};

/** The error for an empty required field. */
export function kioskMissingCopy(rule: KioskFieldRule): string {
  return rule.missing ?? `Enter ${rule.label.toLowerCase()}.`;
}

export const KIOSK_FIELD_LIMITS = { name: 120, company: 120, visiting_name: 120, purpose: 280 } as const;
/** Same pattern as the database check. */
export const KIOSK_PHONE_RE = /^[0-9()+\-. ]{7,20}$/;

export type KioskSignInForm = {
  name: string;
  phone?: string | null;
  company?: string | null;
  visiting_name?: string | null;
  purpose?: string | null;
  /** Answer to KIOSK_SICK_QUESTION; null until answered. */
  symptoms?: boolean | null;
  /** The resident picked from the list; never sent with a typed visiting_name. */
  resident_id?: string | null;
};

export type KioskSignInRequest = KioskSignInForm & {
  kind: KioskVisitorKind;
  /** Random UUID made once per form; a retried submit signs in once. */
  client_entry_id: string;
};

export type KioskSignInResponse = { entry_id: string; checked_in_at: string };

export type KioskFieldErrors = Partial<Record<KioskFieldName, string>>;

export type KioskValidatedSignIn = {
  visitor_type: (typeof KIOSK_VISITOR_TYPE)[KioskVisitorKind];
  name: string;
  phone: string | null;
  company: string | null;
  visiting_name: string | null;
  purpose: string | null;
  symptoms: boolean;
  resident_id: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/** Validate one kiosk form against its kind. Shared by the page and the route. */
export function validateKioskSignIn(
  kind: KioskVisitorKind,
  form: KioskSignInForm,
): { ok: true; value: KioskValidatedSignIn } | { ok: false; errors: KioskFieldErrors } {
  const definition = KIOSK_KINDS[kind];
  const has = (field: KioskFieldName) => definition.fields.find((f) => f.name === field);
  const errors: KioskFieldErrors = {};
  const name = clean(form.name);
  const phone = clean(form.phone);
  const company = clean(form.company);
  const visiting = clean(form.visiting_name);
  const purpose = clean(form.purpose);
  const residentId = clean(form.resident_id);

  if (!name) errors.name = kioskMissingCopy(NAME_FIELD);
  else if (name.length > KIOSK_FIELD_LIMITS.name) errors.name = "Use a shorter name.";

  const checkText = (field: "company" | "visiting_name" | "purpose", value: string | null) => {
    const rule = has(field);
    if (!rule) {
      if (value) errors[field] = "This form does not ask for that.";
      return;
    }
    // A picked resident answers the resident field.
    if (rule.required && !value && !(field === "visiting_name" && residentId)) errors[field] = kioskMissingCopy(rule);
    else if (value && value.length > KIOSK_FIELD_LIMITS[field]) errors[field] = "That is too long.";
  };
  checkText("company", company);
  checkText("visiting_name", visiting);
  checkText("purpose", purpose);

  if (residentId) {
    if (!has("visiting_name")) errors.visiting_name = "This form does not ask for that.";
    else if (!UUID_RE.test(residentId)) errors.visiting_name = kioskMissingCopy(has("visiting_name")!);
    else if (visiting) errors.visiting_name = "Pick the resident or type their name, not both.";
  }

  if (phone) {
    if (!has("phone")) errors.phone = "This form does not ask for that.";
    else if (!KIOSK_PHONE_RE.test(phone)) errors.phone = "Enter a phone number with 7 to 20 digits.";
  }

  if (has("symptoms")) {
    if (typeof form.symptoms !== "boolean") errors.symptoms = kioskMissingCopy(SYMPTOMS_FIELD);
  } else if (form.symptoms === true) {
    errors.symptoms = "This form does not ask for that.";
  }

  if (Object.keys(errors).length > 0 || !name) return { ok: false, errors };
  return {
    ok: true,
    value: {
      visitor_type: KIOSK_VISITOR_TYPE[kind],
      name,
      phone,
      company,
      visiting_name: visiting,
      purpose,
      symptoms: form.symptoms === true,
      resident_id: residentId,
    },
  };
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export type KioskOpenVisit = {
  entry_id: string;
  /** First name and last initial, e.g. "Jordan P." Never a resident name. */
  display_name: string;
  type_label: string;
  checked_in_at: string;
};

export type KioskOpenMatchesResponse = { matches: KioskOpenVisit[] };

/** Letters in a sign-out prefix, the way the database counts them. */
export function kioskPrefixLetterCount(prefix: string): number {
  return (prefix.match(/\p{L}/gu) ?? []).length;
}

export type KioskSignOutRequest = { entry_id: string };

export type KioskSignOutResponse = { checked_in_at: string; checked_out_at: string; display_name: string };

// ---------------------------------------------------------------------------
// Resident picker
// ---------------------------------------------------------------------------

export type KioskResidentMatch = {
  resident_id: string;
  /** Preferred or first name and last initial, e.g. "Martha J." */
  display_name: string;
  room: string | null;
};

export type KioskResidentMatchesResponse = { matches: KioskResidentMatch[] };

/** `Room 12`, or nothing when the resident has no room on file. */
export function kioskRoomLabel(room: string | null | undefined): string {
  const value = typeof room === "string" ? room.trim() : "";
  return value ? `Room ${value}` : "";
}

/** `Martha J. · Room 12` for the picked state. */
export function kioskResidentPickedLabel(match: KioskResidentMatch): string {
  const room = kioskRoomLabel(match.room);
  return room ? `${match.display_name} · ${room}` : match.display_name;
}

export const KIOSK_RESIDENT_COPY = {
  noMatch: "No match. Check the spelling or tap Not listed.",
  searching: "Looking for the resident.",
  change: "Change",
  notListed: "Not listed? Type their name",
  typedHint: "Staff will confirm who you are visiting.",
  backToList: "Find them in the list instead",
  listLabel: "Matching residents",
} as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type KioskVisitorErrorCode = "device_unknown" | "device_throttled" | "invalid_input" | "not_found" | "already_signed_out" | "unavailable";

export type KioskVisitorErrorResponse = { error: KioskVisitorErrorCode; fields?: KioskFieldErrors };

export const KIOSK_VISITOR_ERROR_STATUS: Record<KioskVisitorErrorCode, number> = {
  device_unknown: 401,
  device_throttled: 429,
  invalid_input: 400,
  not_found: 404,
  already_signed_out: 409,
  unavailable: 503,
};

/** Seconds a throttled kiosk waits (the device throttle lasts 5 minutes, spec 37 §4.1). */
export const KIOSK_VISITOR_THROTTLE_RETRY_SECONDS = 300;

export const KIOSK_VISITOR_ERROR_COPY: Record<KioskVisitorErrorCode, string> = {
  device_unknown: "This kiosk is not set up yet. Please see the front desk.",
  device_throttled: "This kiosk is busy. Please try again in a few minutes or see the front desk.",
  invalid_input: "Something was missing. Check the form and try again.",
  not_found: "We could not find that visit. Please see the front desk.",
  already_signed_out: "You are already signed out.",
  unavailable: "The kiosk could not reach Haven. Please see the front desk.",
};

/** Rendered kiosk visitor copy (`10`, `14b`, `16`, `17`). */
export const KIOSK_VISITOR_COPY = {
  sickWarning: "Please see the front desk before you go in.",
  visitorLogLine: "Your name and times go in the facility visitor log.",
  /** "When you leave, tap **Sign out** on the home screen." */
  signOutReminder: { before: "When you leave, tap ", strong: "Sign out", after: " on the home screen." },
  signOutPrompt: "Leaving? Sign out",
  signOutHint: "Type the first 3 letters of your first name",
} as const;
