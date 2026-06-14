export type ContactCategory =
  | "pharmacy"
  | "hospice"
  | "physician"
  | "hospital"
  | "ahca"
  | "mco_case_manager"
  | "dcf"
  | "emergency_service"
  | "vendor"
  | "other";

export const CONTACT_CATEGORIES: { id: ContactCategory; label: string }[] = [
  { id: "pharmacy", label: "Pharmacy" },
  { id: "hospice", label: "Hospice" },
  { id: "physician", label: "Physician" },
  { id: "hospital", label: "Hospital" },
  { id: "ahca", label: "AHCA field office" },
  { id: "mco_case_manager", label: "MCO case manager" },
  { id: "dcf", label: "DCF" },
  { id: "emergency_service", label: "Emergency service" },
  { id: "vendor", label: "Vendor" },
  { id: "other", label: "Other" },
];

export type FacilityContactRow = {
  id: string;
  name: string;
  category: ContactCategory;
  organization_name: string | null;
  phone: string | null;
  after_hours_phone: string | null;
  fax: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

export type OnCallShiftRow = {
  id: string;
  role_label: string;
  on_call_user_id: string | null;
  on_call_name: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function contactCategoryLabel(id: string): string {
  return CONTACT_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

/** On-call shifts overlapping "now" (inclusive of start, exclusive of end). */
export function activeOnCall(shifts: OnCallShiftRow[], nowIso: string): OnCallShiftRow[] {
  return shifts.filter((s) => s.starts_at <= nowIso && s.ends_at > nowIso);
}
