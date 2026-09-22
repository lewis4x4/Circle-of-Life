/**
 * COL-597: in-place edit of a resident's clinical facts.
 *
 * The overview used to name fourteen gaps and link every one of them back to
 * itself. Each gap now opens an editor that writes through
 * `public.resident_record_field_save` (migration 460). That function — not this
 * file — decides who may record what: it applies the intake flow's own reviewer
 * rule, so nothing here restates a role list. The UI asks
 * `resident_record_field_sources` whether the caller may edit, and where each
 * current value came from.
 */

export const RESIDENT_RECORD_FIELDS = [
  "code_status",
  "allergy_list",
  "diagnoses",
  "primary_physician",
  "do_not_hospitalize",
  "feeding_tube",
  "hospice_status",
  "polst_molst",
] as const;

export type ResidentRecordField = (typeof RESIDENT_RECORD_FIELDS)[number];

export type ResidentRecordFieldSource =
  | { kind: "person"; at: string; byName: string | null; action: "set" | "verify" }
  | { kind: "document"; at: string; byName: string | null; documentTitle: string | null };

export type ResidentRecordFieldState = { canEdit: boolean; source: ResidentRecordFieldSource | null };

export type ResidentRecordFieldStates = Record<ResidentRecordField, ResidentRecordFieldState>;

export const RESIDENT_RECORD_FIELD_TITLES: Record<ResidentRecordField, string> = {
  code_status: "Code status",
  allergy_list: "Allergies",
  diagnoses: "Diagnoses",
  primary_physician: "Primary care physician",
  do_not_hospitalize: "DNH (Do Not Hospitalize)",
  feeding_tube: "Feeding tube",
  hospice_status: "Hospice election",
  polst_molst: "POLST / MOLST",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Parse the RPC's jsonb. Anything malformed is "cannot edit, source unknown" — never an editable guess. */
export function parseResidentRecordFieldStates(raw: unknown): ResidentRecordFieldStates | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const out = {} as ResidentRecordFieldStates;
  for (const field of RESIDENT_RECORD_FIELDS) {
    const entry = record[field] as Record<string, unknown> | undefined;
    const sourceRaw = entry?.source as Record<string, unknown> | null | undefined;
    let source: ResidentRecordFieldSource | null = null;
    const at = str(sourceRaw?.at);
    if (sourceRaw && at && sourceRaw.kind === "person") {
      source = { kind: "person", at, byName: str(sourceRaw.by_name), action: sourceRaw.action === "verify" ? "verify" : "set" };
    } else if (sourceRaw && at && sourceRaw.kind === "document") {
      source = { kind: "document", at, byName: str(sourceRaw.by_name), documentTitle: str(sourceRaw.document_title) };
    }
    out[field] = { canEdit: entry?.can_edit === true, source };
  }
  return out;
}

const whenFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : whenFormatter.format(d);
}

/** "Recorded on the resident record by Jane Doe, Sep 22, 2026, 1:26 PM" / "From admission document …". */
export function formatFieldSource(source: ResidentRecordFieldSource | null): string {
  if (!source) return "Source not recorded";
  const who = source.byName ?? "a staff member (not attributed)";
  if (source.kind === "person") {
    const verb = source.action === "verify" ? "Verified" : "Recorded";
    return `${verb} on the resident record by ${who}, ${when(source.at)}`;
  }
  const doc = source.documentTitle ? `admission document “${source.documentTitle}”` : "an admission document";
  return `From ${doc}, applied by ${who}, ${when(source.at)}`;
}

export type SelectOption = { value: string; label: string };

/**
 * Code status values the record already recognises (`resolveCodeStatusPresentation`).
 * Offered, not enforced: the column has always been free text and imported
 * values stay readable.
 */
export const CODE_STATUS_OPTIONS: SelectOption[] = [
  { value: "full_code", label: "Full code" },
  { value: "dnr", label: "DNR — Do not resuscitate" },
  { value: "dni", label: "DNI — Do not intubate" },
  { value: "dnr_dni", label: "DNR/DNI" },
  { value: "comfort_care", label: "Comfort care only" },
];

/** Mirrors the `residents.feeding_tube` CHECK in migration 460. */
export const FEEDING_TUBE_OPTIONS: SelectOption[] = [
  { value: "none", label: "No feeding tube" },
  { value: "g_tube", label: "G-tube" },
  { value: "j_tube", label: "J-tube" },
  { value: "gj_tube", label: "GJ-tube" },
  { value: "peg", label: "PEG" },
  { value: "ng_tube", label: "NG tube" },
  { value: "other", label: "Other (describe)" },
];

export function feedingTubeLabel(value: string | null): string {
  if (!value) return "Not recorded";
  return FEEDING_TUBE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** The `hospice_status` enum. */
export const HOSPICE_OPTIONS: SelectOption[] = [
  { value: "none", label: "Not enrolled" },
  { value: "pending", label: "Pending hospice election" },
  { value: "active", label: "Active hospice election" },
  { value: "ended", label: "Hospice concluded" },
];

/** `polst_status` minus `none` — recording a form means one exists. */
export const POLST_STATUS_OPTIONS: SelectOption[] = [
  { value: "on_file", label: "On file (not yet verified)" },
  { value: "verified", label: "Verified" },
  { value: "revoked", label: "Revoked / superseded" },
];

export function dnhLabel(value: boolean | null): string {
  if (value === true) return "In effect";
  if (value === false) return "Not in effect";
  return "Not recorded";
}

/** One entry per line; blank lines dropped; a repeat differing only in case kept once. */
export function linesToList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Operator copy for the RPC's refusals. */
export function residentRecordEditErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "P0409") return "Someone changed this resident's record since you opened it. Close this, and try again on the refreshed record.";
  if (e?.code === "42501") return "Your role can't record this on the resident record. A clinical reviewer can.";
  if (e?.code === "22023" && e.message) return e.message;
  if (e?.code === "23514") return "That value isn't one the record accepts.";
  return e?.message ? `Not saved: ${e.message}` : "Not saved. Check your connection and try again.";
}
