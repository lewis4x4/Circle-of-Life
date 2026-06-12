export type InternalFormCategory =
  | "maintenance"
  | "supply"
  | "grievance"
  | "refund"
  | "general";

export type InternalFormFieldType = "text" | "textarea" | "number" | "date" | "select";

export type SubmissionStatus = "submitted" | "in_progress" | "resolved" | "rejected";

export const INTERNAL_FORM_CATEGORIES: { id: InternalFormCategory; label: string }[] = [
  { id: "maintenance", label: "Maintenance request" },
  { id: "supply", label: "Supply request" },
  { id: "grievance", label: "Grievance intake" },
  { id: "refund", label: "Refund request" },
  { id: "general", label: "General" },
];

export const FIELD_TYPES: { id: InternalFormFieldType; label: string }[] = [
  { id: "text", label: "Short text" },
  { id: "textarea", label: "Long text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "select", label: "Dropdown" },
];

export type InternalFormField = {
  key: string;
  label: string;
  type: InternalFormFieldType;
  required: boolean;
  options: string[];
};

export type InternalFormTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  category: InternalFormCategory;
  fields: InternalFormField[];
  is_active: boolean;
  created_at: string;
};

export type InternalFormSubmissionRow = {
  id: string;
  template_id: string;
  template_name: string;
  category: InternalFormCategory;
  values: Record<string, string>;
  status: SubmissionStatus;
  resolution_notes: string | null;
  resolved_at: string | null;
  submitted_by: string;
  submitted_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function categoryLabel(id: string): string {
  return INTERNAL_FORM_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export function submissionStatusTone(
  status: SubmissionStatus,
): "info" | "warning" | "success" | "danger" {
  switch (status) {
    case "submitted":
      return "info";
    case "in_progress":
      return "warning";
    case "resolved":
      return "success";
    case "rejected":
      return "danger";
  }
}

/** Stable field key from a label ("Room / area" -> "room_area"). */
export function fieldKeyFromLabel(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let key = base;
  let n = 2;
  while (taken.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

/** Parse the jsonb fields column defensively (templates are admin-authored). */
export function parseFields(value: unknown): InternalFormField[] {
  if (!Array.isArray(value)) return [];
  const out: InternalFormField[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.key !== "string" || typeof f.label !== "string") continue;
    const type = FIELD_TYPES.some((t) => t.id === f.type)
      ? (f.type as InternalFormFieldType)
      : "text";
    out.push({
      key: f.key,
      label: f.label,
      type,
      required: f.required === true,
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : [],
    });
  }
  return out;
}
