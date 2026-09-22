export type AckRequirementRow = {
  id: string;
  document_id: string;
  document_title: string;
  document_content_snapshot?: string | null;
  document_version_hash?: string | null;
  required_roles: string[];
  require_signature: boolean;
  due_date: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
};

export type AcknowledgmentRow = {
  id: string;
  requirement_id: string;
  document_id: string;
  user_id: string;
  signature_name: string;
  signer_role: string;
  acknowledged_at: string;
};

export type StaffProfileMini = {
  id: string;
  full_name: string;
  app_role: string;
  is_active: boolean;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

/** Staff roles that can be required to acknowledge (excludes family/broker). */
export const ACK_ROLES: { id: string; label: string }[] = [
  { id: "facility_admin", label: "Facility admin" },
  { id: "manager", label: "Manager" },
  { id: "admin_assistant", label: "Admin assistant" },
  { id: "coordinator", label: "Coordinator" },
  { id: "med_tech", label: "Med tech" },
  { id: "cook", label: "Cook" },
  { id: "maintenance_role", label: "Maintenance" },
  { id: "housekeeper", label: "Housekeeper" },
  { id: "marketing", label: "Marketing" },
];

/** Retired roles (2026-09-22, migration 464) — labels for requirement rows written before the fold. */
const LEGACY_ACK_ROLE_LABELS: Record<string, string> = {
  nurse: "Nurse (retired)",
  caregiver: "Caregiver (retired)",
  dietary: "Dietary (retired)",
  dietary_aide: "Dietary aide (retired)",
};

export function roleLabel(id: string): string {
  return ACK_ROLES.find((r) => r.id === id)?.label ?? LEGACY_ACK_ROLE_LABELS[id] ?? id.replace(/_/g, " ");
}

/** Outstanding = active staff whose role is required and who have not signed. */
export function outstandingForRequirement(
  requirement: AckRequirementRow,
  staff: StaffProfileMini[],
  acks: AcknowledgmentRow[],
): StaffProfileMini[] {
  const signed = new Set(
    acks.filter((a) => a.requirement_id === requirement.id).map((a) => a.user_id),
  );
  return staff.filter(
    (s) =>
      s.is_active &&
      requirement.required_roles.includes(s.app_role) &&
      !signed.has(s.id),
  );
}
