import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type LetterCategory =
  | "rate_increase"
  | "family"
  | "dcf_payee"
  | "employment_verification"
  | "general";

export type LetterSubjectKind = "resident" | "staff" | "none";

export const LETTER_CATEGORIES: { id: LetterCategory; label: string }[] = [
  { id: "rate_increase", label: "Rate increase notice" },
  { id: "family", label: "Family letter" },
  { id: "dcf_payee", label: "DCF / payee correspondence" },
  { id: "employment_verification", label: "Employment verification" },
  { id: "general", label: "General" },
];

export type LetterTemplateRow = {
  id: string;
  name: string;
  category: LetterCategory;
  subject_kind: LetterSubjectKind;
  body: string;
  created_at: string;
};

export type GeneratedLetterRow = {
  id: string;
  template_name: string;
  category: LetterCategory;
  resident_id: string | null;
  staff_user_id: string | null;
  recipient_name: string | null;
  rendered_body: string;
  merge_values: Record<string, string>;
  generated_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export type FacilityLetterhead = {
  name: string;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  fax: string | null;
  license_number: string | null;
  administrator_name: string | null;
};

/** Merge fields available per subject kind, shown in the template editor. */
export const MERGE_FIELD_REFERENCE: Record<LetterSubjectKind, string[]> = {
  resident: [
    "{{resident.full_name}}",
    "{{resident.first_name}}",
    "{{resident.last_name}}",
    "{{resident.date_of_birth}}",
    "{{resident.admission_date}}",
    "{{resident.monthly_total_rate}}",
    "{{resident.emergency_contact_1_name}}",
  ],
  staff: [
    "{{staff.full_name}}",
    "{{staff.job_title}}",
    "{{staff.email}}",
    "{{staff.phone}}",
  ],
  none: [],
};

export const COMMON_MERGE_FIELDS = [
  "{{facility.name}}",
  "{{facility.address}}",
  "{{facility.phone}}",
  "{{facility.license_number}}",
  "{{facility.administrator_name}}",
  "{{today}}",
];

const ET = "America/New_York";

function todayLongEt(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type ResidentMergeSource = {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  admission_date: string | null;
  monthly_total_rate: number | null;
  emergency_contact_1_name: string | null;
};

export type StaffMergeSource = {
  full_name: string;
  job_title: string | null;
  email: string;
  phone: string | null;
};

/** Build the flat merge map for a template render. */
export function buildMergeValues(args: {
  facility: FacilityLetterhead;
  resident?: ResidentMergeSource | null;
  staff?: StaffMergeSource | null;
}): Record<string, string> {
  const { facility, resident, staff } = args;
  const values: Record<string, string> = {
    "facility.name": facility.name,
    "facility.address": [
      facility.address_line_1,
      facility.address_line_2,
      `${facility.city}, ${facility.state} ${facility.zip}`,
    ]
      .filter(Boolean)
      .join(", "),
    "facility.phone": facility.phone ?? "—",
    "facility.license_number": facility.license_number ?? "—",
    "facility.administrator_name": facility.administrator_name ?? "—",
    today: todayLongEt(),
  };
  if (resident) {
    values["resident.full_name"] = `${resident.first_name} ${resident.last_name}`.trim();
    values["resident.first_name"] = resident.first_name;
    values["resident.last_name"] = resident.last_name;
    values["resident.date_of_birth"] = formatDateLong(resident.date_of_birth);
    values["resident.admission_date"] = formatDateLong(resident.admission_date);
    values["resident.monthly_total_rate"] = formatCents(resident.monthly_total_rate);
    values["resident.emergency_contact_1_name"] = resident.emergency_contact_1_name ?? "—";
  }
  if (staff) {
    values["staff.full_name"] = staff.full_name;
    values["staff.job_title"] = staff.job_title ?? "—";
    values["staff.email"] = staff.email;
    values["staff.phone"] = staff.phone ?? "—";
  }
  return values;
}

/** Replace {{merge.fields}}; unknown fields stay visible so gaps are obvious. */
export function renderLetterBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (raw, key: string) => {
    const v = values[key];
    return v !== undefined ? v : raw;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Standalone print document: rendered letter body on facility letterhead.
 * PDF output = browser print-to-PDF (repo convention; no PDF dependency).
 */
export function buildLetterPrintHtml(args: {
  facility: FacilityLetterhead;
  renderedBody: string;
  templateName: string;
}): string {
  const { facility, renderedBody, templateName } = args;
  const addressLine = [
    facility.address_line_1,
    facility.address_line_2,
    `${facility.city}, ${facility.state} ${facility.zip}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const contactLine = [
    facility.phone ? `Tel ${facility.phone}` : null,
    facility.fax ? `Fax ${facility.fax}` : null,
    facility.license_number ? `License ${facility.license_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(templateName)} — ${escapeHtml(facility.name)}</title>
<style>
  @page { size: letter; margin: 1in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; margin: 0; font-size: 12.5pt; line-height: 1.55; }
  header { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 28px; }
  .fname { font-size: 17pt; font-weight: 700; letter-spacing: 0.02em; }
  .fmeta { font-size: 9.5pt; color: #444; margin-top: 4px; }
  main { white-space: pre-wrap; }
  footer { margin-top: 40px; font-size: 8.5pt; color: #777; border-top: 1px solid #ccc; padding-top: 8px; }
  @media screen { body { max-width: 8.5in; margin: 24px auto; padding: 0 32px; } }
</style>
</head>
<body>
<header>
  <div class="fname">${escapeHtml(facility.name)}</div>
  <div class="fmeta">${escapeHtml(addressLine)}</div>
  ${contactLine ? `<div class="fmeta">${escapeHtml(contactLine)}</div>` : ""}
</header>
<main>${escapeHtml(renderedBody)}</main>
<footer>Generated by Haven · ${escapeHtml(facility.name)} · ${escapeHtml(todayLongEt())}</footer>
</body>
</html>`;
}

/** Letterhead fields for the selected facility. */
export async function fetchFacilityLetterhead(
  supabase: SupabaseClient<Database>,
  facilityId: string,
): Promise<FacilityLetterhead> {
  const { data, error } = await supabase
    .from("facilities")
    .select(
      "name, address_line_1, address_line_2, city, state, zip, phone, fax, license_number, administrator_name",
    )
    .eq("id", facilityId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Facility not found.");
  return data as FacilityLetterhead;
}
