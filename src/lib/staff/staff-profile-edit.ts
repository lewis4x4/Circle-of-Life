/**
 * In-place staff profile section edits (`/admin/staff/[id]`).
 * Patch builders keep optional text as SQL NULL when cleared (Quiet Operator display copy).
 */

export const STAFF_PROFILE_SELECT_COLUMNS = [
  "id",
  "facility_id",
  "first_name",
  "last_name",
  "preferred_name",
  "phone",
  "phone_alt",
  "email",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "zip",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "staff_role",
  "employment_status",
  "hire_date",
  "termination_date",
  "termination_reason",
  "hourly_rate",
  "overtime_rate",
  "is_full_time",
  "is_float_pool",
  "max_hours_per_week",
  "photo_url",
  "notes",
  "updated_at",
] as const;

export type StaffProfileRow = {
  id: string;
  facility_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  phone: string | null;
  phone_alt: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  staff_role: string;
  employment_status: string;
  hire_date: string;
  termination_date: string | null;
  termination_reason: string | null;
  hourly_rate: number | null;
  overtime_rate: number | null;
  is_full_time: boolean;
  is_float_pool: boolean;
  max_hours_per_week: number | null;
  photo_url: string | null;
  notes: string | null;
  updated_at: string | null;
};

export type StaffProfileSection =
  | "name"
  | "contact"
  | "emergency"
  | "address"
  | "employment"
  | "compensation";

export type StaffProfileDraft = {
  first_name: string;
  last_name: string;
  preferred_name: string;
  phone: string;
  phone_alt: string;
  email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zip: string;
  hire_date: string;
  employment_status: string;
  termination_date: string;
  termination_reason: string;
  is_full_time: boolean;
  is_float_pool: boolean;
  max_hours_per_week: string;
  hourly_rate_dollars: string;
  overtime_rate_dollars: string;
};

export type StaffProfilePatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

const EMPLOYMENT_STATUS_CREATE_OPTIONS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
];

const LEGACY_EMPLOYMENT_STATUSES: Record<string, string> = {
  terminated: "Terminated",
  suspended: "Suspended",
};

export function canEditStaffProfile(appRole: string): boolean {
  return appRole === "owner" || appRole === "org_admin" || appRole === "facility_admin";
}

export function staffProfileEmploymentStatusOptions(current: string): { value: string; label: string }[] {
  const opts = [...EMPLOYMENT_STATUS_CREATE_OPTIONS];
  if (current === "terminated" || current === "suspended") {
    if (!opts.some((o) => o.value === current)) {
      opts.push({ value: current, label: LEGACY_EMPLOYMENT_STATUSES[current] ?? current });
    }
  }
  return opts;
}

function optionalTextToNull(value: string): string | null {
  const t = value.trim();
  return t ? t : null;
}

export function staffRateCentsToDollarInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const n = typeof cents === "number" ? cents : Number(cents);
  if (Number.isNaN(n)) return "";
  const whole = Math.trunc(n / 100);
  const fraction = Math.abs(n % 100);
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function staffRateDollarInputToCents(
  input: string,
): { ok: true; cents: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, cents: null };

  const normalized = trimmed.replace(/^\$/, "").replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) {
    return { ok: false, error: "Enter a valid dollar amount (e.g. 18.50)." };
  }

  const negative = match[1] === "-";
  const whole = Number(match[2]);
  const fracRaw = match[3] ?? "";
  let fraction = 0;
  if (fracRaw.length === 1) fraction = Number(fracRaw) * 10;
  else if (fracRaw.length === 2) fraction = Number(fracRaw);
  if (Number.isNaN(whole) || Number.isNaN(fraction)) {
    return { ok: false, error: "Enter a valid dollar amount (e.g. 18.50)." };
  }

  const cents = whole * 100 + fraction;
  return { ok: true, cents: negative ? -cents : cents };
}

export function staffProfileDraftFromRow(row: StaffProfileRow): StaffProfileDraft {
  return {
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    preferred_name: row.preferred_name ?? "",
    phone: row.phone ?? "",
    phone_alt: row.phone_alt ?? "",
    email: row.email ?? "",
    emergency_contact_name: row.emergency_contact_name ?? "",
    emergency_contact_phone: row.emergency_contact_phone ?? "",
    emergency_contact_relationship: row.emergency_contact_relationship ?? "",
    address_line_1: row.address_line_1 ?? "",
    address_line_2: row.address_line_2 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    hire_date: row.hire_date ?? "",
    employment_status: row.employment_status ?? "active",
    termination_date: row.termination_date ?? "",
    termination_reason: row.termination_reason ?? "",
    is_full_time: row.is_full_time,
    is_float_pool: row.is_float_pool,
    max_hours_per_week:
      row.max_hours_per_week == null ? "" : String(row.max_hours_per_week),
    hourly_rate_dollars: staffRateCentsToDollarInput(row.hourly_rate),
    overtime_rate_dollars: staffRateCentsToDollarInput(row.overtime_rate),
  };
}

type MaxHoursParseResult = { ok: true; hours: number | null } | { ok: false; error: string };

function parseMaxHours(value: string): MaxHoursParseResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, hours: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Max hours per week must be a non-negative number." };
  }
  return { ok: true, hours: n };
}

export function buildStaffProfileSectionPatch(
  section: StaffProfileSection,
  draft: StaffProfileDraft,
  updatedBy: string,
  currentStatus: string,
): StaffProfilePatchResult {
  const base = { updated_by: updatedBy };

  if (section === "name") {
    const first = draft.first_name.trim();
    const last = draft.last_name.trim();
    if (!first || !last) {
      return { ok: false, error: "First and last name are required." };
    }
    return {
      ok: true,
      patch: {
        ...base,
        first_name: first,
        last_name: last,
        preferred_name: optionalTextToNull(draft.preferred_name),
      },
    };
  }

  if (section === "contact") {
    return {
      ok: true,
      patch: {
        ...base,
        phone: optionalTextToNull(draft.phone),
        phone_alt: optionalTextToNull(draft.phone_alt),
        email: optionalTextToNull(draft.email),
      },
    };
  }

  if (section === "emergency") {
    return {
      ok: true,
      patch: {
        ...base,
        emergency_contact_name: optionalTextToNull(draft.emergency_contact_name),
        emergency_contact_phone: optionalTextToNull(draft.emergency_contact_phone),
        emergency_contact_relationship: optionalTextToNull(draft.emergency_contact_relationship),
      },
    };
  }

  if (section === "address") {
    return {
      ok: true,
      patch: {
        ...base,
        address_line_1: optionalTextToNull(draft.address_line_1),
        address_line_2: optionalTextToNull(draft.address_line_2),
        city: optionalTextToNull(draft.city),
        state: optionalTextToNull(draft.state),
        zip: optionalTextToNull(draft.zip),
      },
    };
  }

  if (section === "employment") {
    const hire = draft.hire_date.trim();
    if (!hire) {
      return { ok: false, error: "Hire date is required." };
    }
    const status = draft.employment_status.trim() || currentStatus;
    const maxParsed = parseMaxHours(draft.max_hours_per_week);
    if (!maxParsed.ok) {
      return { ok: false, error: maxParsed.error };
    }

    return {
      ok: true,
      patch: {
        ...base,
        hire_date: hire,
        employment_status: status,
        termination_date: optionalTextToNull(draft.termination_date),
        termination_reason: optionalTextToNull(draft.termination_reason),
        is_full_time: draft.is_full_time,
        is_float_pool: draft.is_float_pool,
        max_hours_per_week: maxParsed.hours,
      },
    };
  }

  if (section === "compensation") {
    const hourly = staffRateDollarInputToCents(draft.hourly_rate_dollars);
    if (!hourly.ok) return hourly;
    const overtime = staffRateDollarInputToCents(draft.overtime_rate_dollars);
    if (!overtime.ok) return overtime;

    return {
      ok: true,
      patch: {
        ...base,
        hourly_rate: hourly.cents,
        overtime_rate: overtime.cents,
      },
    };
  }

  return { ok: false, error: "Unknown section." };
}

export function staffProfileSelectSql(): string {
  return STAFF_PROFILE_SELECT_COLUMNS.join(", ");
}
