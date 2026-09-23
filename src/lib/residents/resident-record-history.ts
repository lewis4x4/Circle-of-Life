/**
 * COL-627: the resident record's history of in-place edits.
 *
 * `public.resident_record_field_history` (migration 470) returns, newest first
 * and capped, every change to the eight in-place fields — typed on the record
 * (`resident_record_field_edits`, 461) or applied from an admission document —
 * plus the admission-document facts that went `stale` on apply because someone
 * changed the same field on the record first. The server decides what a caller
 * may see: document titles, document values and intake ids come back only to
 * roles that may read intake.
 */
import {
  CODE_STATUS_OPTIONS,
  FEEDING_TUBE_OPTIONS,
  HOSPICE_OPTIONS,
  POLST_STATUS_OPTIONS,
  RESIDENT_RECORD_FIELDS,
  dnhLabel,
  type ResidentRecordField,
} from "@/lib/residents/resident-record-edit";

/** Rows asked for; the server caps at 200. */
export const RESIDENT_RECORD_HISTORY_LIMIT = 50;

export type ResidentRecordHistoryEntry = {
  id: string;
  field: ResidentRecordField;
  kind: "person" | "document";
  action: "set" | "verify";
  at: string;
  byName: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  documentValue: string | null;
  documentTitle: string | null;
};

export type ResidentRecordStaleFact = {
  field: ResidentRecordField;
  at: string;
  intakeId: string | null;
  documentTitle: string | null;
};

export type ResidentRecordHistory = {
  entries: ResidentRecordHistoryEntry[];
  stale: ResidentRecordStaleFact[];
  limit: number;
  truncated: boolean;
};

const FIELDS = new Set<string>(RESIDENT_RECORD_FIELDS);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Parse the RPC's jsonb; rows naming an unknown field or lacking a time are dropped, never guessed at. */
export function parseResidentRecordHistory(raw: unknown): ResidentRecordHistory | null {
  const root = obj(raw);
  if (!root) return null;
  const entries: ResidentRecordHistoryEntry[] = [];
  for (const item of Array.isArray(root.entries) ? root.entries : []) {
    const row = obj(item);
    const field = str(row?.field);
    const at = str(row?.at);
    const id = str(row?.id);
    if (!row || !field || !FIELDS.has(field) || !at || !id) continue;
    entries.push({
      id,
      field: field as ResidentRecordField,
      kind: row.kind === "document" ? "document" : "person",
      action: row.action === "verify" ? "verify" : "set",
      at,
      byName: str(row.by_name),
      previousValue: obj(row.previous_value),
      newValue: obj(row.new_value),
      documentValue: str(row.document_value),
      documentTitle: str(row.document_title),
    });
  }
  const stale: ResidentRecordStaleFact[] = [];
  for (const item of Array.isArray(root.stale) ? root.stale : []) {
    const row = obj(item);
    const field = str(row?.field);
    const at = str(row?.at);
    if (!row || !field || !FIELDS.has(field) || !at) continue;
    stale.push({ field: field as ResidentRecordField, at, intakeId: str(row.intake_id), documentTitle: str(row.document_title) });
  }
  const limit = typeof root.limit === "number" ? root.limit : RESIDENT_RECORD_HISTORY_LIMIT;
  return { entries, stale, limit, truncated: root.truncated === true };
}

function optionLabel(options: { value: string; label: string }[], value: unknown): string | null {
  const v = str(value);
  if (!v) return null;
  return options.find((o) => o.value === v)?.label ?? v;
}

function list(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

const NOT_RECORDED = "Not recorded";

/** One side of a change, in words. `null` value means the field was empty. */
export function describeFieldValue(field: ResidentRecordField, value: Record<string, unknown> | null): string {
  if (!value) return NOT_RECORDED;
  switch (field) {
    case "code_status":
      return optionLabel(CODE_STATUS_OPTIONS, value.code_status) ?? NOT_RECORDED;
    case "allergy_list": {
      const items = list(value.allergy_list);
      if (items == null) return NOT_RECORDED;
      return items.length === 0 ? "No known allergies" : items.join("; ");
    }
    case "diagnoses": {
      const primary = str(value.primary_diagnosis);
      const others = (list(value.diagnosis_list) ?? []).filter((d) => d !== primary);
      if (!primary && others.length === 0) return NOT_RECORDED;
      return [primary ? `Primary: ${primary}` : null, others.length > 0 ? `Also: ${others.join("; ")}` : null]
        .filter(Boolean)
        .join(" · ");
    }
    case "primary_physician": {
      const name = str(value.name);
      if (!name) return NOT_RECORDED;
      return `${name} · ${str(value.phone) ?? "phone not recorded"}`;
    }
    case "do_not_hospitalize":
      return dnhLabel(typeof value.do_not_hospitalize === "boolean" ? value.do_not_hospitalize : null);
    case "feeding_tube": {
      const tube = optionLabel(FEEDING_TUBE_OPTIONS, value.feeding_tube);
      if (!tube) return NOT_RECORDED;
      const notes = str(value.notes);
      return notes ? `${tube} (${notes})` : tube;
    }
    case "hospice_status":
      return optionLabel(HOSPICE_OPTIONS, value.hospice_status) ?? NOT_RECORDED;
    case "polst_molst": {
      const type = str(value.document_type);
      if (!type) return NOT_RECORDED;
      const status = optionLabel(POLST_STATUS_OPTIONS, value.polst_status);
      const signed = str(value.physician_signature_date);
      return [type.toUpperCase(), status, signed ? `signed ${signed}` : null].filter(Boolean).join(" · ");
    }
  }
}

/** "Before → after", or what was verified. */
export function describeHistoryChange(entry: ResidentRecordHistoryEntry): string {
  if (entry.kind === "document") {
    return entry.documentValue ? `Set to ${entry.documentValue}` : "Set from an admission document";
  }
  if (entry.action === "verify") {
    return `Verified as ${describeFieldValue(entry.field, entry.newValue)}`;
  }
  return `${describeFieldValue(entry.field, entry.previousValue)} → ${describeFieldValue(entry.field, entry.newValue)}`;
}

const whenFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function historyWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : whenFormatter.format(d);
}

/** Who and from where: "Jane Doe, on the resident record" / "Applied by Jane Doe from admission document “Packet”". */
export function describeHistorySource(entry: ResidentRecordHistoryEntry): string {
  const who = entry.byName ?? "a staff member (not attributed)";
  if (entry.kind === "person") return `${who}, on the resident record`;
  const doc = entry.documentTitle ? `admission document “${entry.documentTitle}”` : "an admission document";
  return `Applied by ${who} from ${doc}`;
}

export const STALE_FACT_LEAD =
  "An admission-document value for this field was not applied because the record changed first.";
export const STALE_FACT_ACTION = "Review it in Admission documents";

export function intakeReviewHref(intakeId: string): string {
  return `/admin/admissions/intake/${intakeId}`;
}

/** Fields with history or a stale notice, in the record's field order; entries stay newest first. */
export function groupResidentRecordHistory(history: ResidentRecordHistory): {
  field: ResidentRecordField;
  entries: ResidentRecordHistoryEntry[];
  stale: ResidentRecordStaleFact[];
}[] {
  return RESIDENT_RECORD_FIELDS.map((field) => ({
    field,
    entries: history.entries.filter((e) => e.field === field),
    stale: history.stale.filter((s) => s.field === field),
  })).filter((g) => g.entries.length > 0 || g.stale.length > 0);
}
