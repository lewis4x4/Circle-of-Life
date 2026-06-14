export type VisitorType = "family" | "vendor" | "contractor" | "medical" | "official" | "other";
export type PackageType = "package" | "mail" | "perishable" | "medication" | "other";
export type CallDirection = "inbound" | "outbound";

export const VISITOR_TYPES: { id: VisitorType; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "vendor", label: "Vendor" },
  { id: "contractor", label: "Contractor" },
  { id: "medical", label: "Medical" },
  { id: "official", label: "Official / surveyor" },
  { id: "other", label: "Other" },
];

export const PACKAGE_TYPES: { id: PackageType; label: string }[] = [
  { id: "package", label: "Package" },
  { id: "mail", label: "Mail" },
  { id: "perishable", label: "Perishable" },
  { id: "medication", label: "Medication" },
  { id: "other", label: "Other" },
];

export type VisitorEntryRow = {
  id: string;
  visitor_name: string;
  visitor_type: VisitorType;
  resident_id: string | null;
  purpose: string | null;
  checked_in_at: string;
  checked_out_at: string | null;
  screening_passed: boolean | null;
  temperature_f: number | null;
  symptoms_reported: boolean;
  screening_notes: string | null;
};

export type PackageEntryRow = {
  id: string;
  resident_id: string | null;
  recipient_name: string;
  carrier: string | null;
  package_type: PackageType;
  description: string | null;
  received_at: string;
  delivered_at: string | null;
  delivered_to_name: string | null;
};

export type FamilyCallEntryRow = {
  id: string;
  resident_id: string;
  caller_name: string;
  relationship: string | null;
  direction: CallDirection;
  call_at: string;
  summary: string;
  follow_up_needed: boolean;
};

export type ResidentMini = { id: string; first_name: string; last_name: string };

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function visitorTypeLabel(id: string): string {
  return VISITOR_TYPES.find((v) => v.id === id)?.label ?? id.replace(/_/g, " ");
}

export function packageTypeLabel(id: string): string {
  return PACKAGE_TYPES.find((p) => p.id === id)?.label ?? id.replace(/_/g, " ");
}

export function residentName(id: string | null, residents: ResidentMini[]): string | null {
  if (!id) return null;
  const r = residents.find((x) => x.id === id);
  return r ? `${r.first_name} ${r.last_name}`.trim() : null;
}
