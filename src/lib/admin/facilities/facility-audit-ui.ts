/**
 * Facility audit log — operator-facing mapping (Quiet Operator · no shouting caps).
 */

export const AUDIT_RETENTION_COPY =
  "Audit events for this facility are retained for seven years under typical Florida ALF record expectations. Older events may be archived to cold storage and produced on request as policy matures.";

export const FACILITY_AUDIT_TAB_HELPER =
  "Every change to this facility's records — license edits, rate changes, vendor links, document uploads, settings — is captured with timestamp and user when audit writes succeed. Required for survey audit and operational accountability. Retention: 7 years.";

/** Visual spec · “Events captured include” educator list (12 bullets). */
export const FACILITY_AUDIT_CAPTURE_BUCKETS = [
  "Facility license filings, renewals, and correction orders",
  "Rate schedules and confirmed rate versions",
  "Document Vault uploads, replacements, categories, and expirations",
  "Vendor directory links, categories, and compliance artifacts",
  "Emergency contact directory (roles, phones, escalation partners)",
  "Building & safety profile (suppression, generator, utilities, inspections)",
  "Operational alert thresholds and notification roles",
  "Communications & visitation policy settings",
  "Staffing hub signals that touch facility-scoped configuration",
  "Facility timeline milestones (survey, renovation, ownership, etc.)",
  "Facility survey history citations and proof documents",
  "System-automated mutations when surfaced (delivery engine TBD)",
] as const;

export type FacilityAuditEntityFilterKey =
  | "facility"
  | "resident"
  | "staff"
  | "vendor"
  | "document"
  | "rate"
  | "threshold"
  | "setting"
  | "emergency_contact"
  | "permission";

export const FACILITY_AUDIT_ENTITY_OPTIONS: ReadonlyArray<{
  key: FacilityAuditEntityFilterKey;
  label: string;
  /** Postgres tables covered in facility_audit_log (empty = scaffold / not yet routed). */
  tables: readonly string[];
}> = [
  { key: "facility", label: "Facility", tables: ["facilities"] },
  { key: "resident", label: "Resident", tables: [] },
  { key: "staff", label: "Staff", tables: [] },
  { key: "vendor", label: "Vendor", tables: ["facility_vendors"] },
  { key: "document", label: "Document", tables: ["facility_documents"] },
  { key: "rate", label: "Rate", tables: ["rate_schedule_versions"] },
  { key: "threshold", label: "Threshold", tables: ["facility_operational_thresholds"] },
  { key: "setting", label: "Setting", tables: ["facility_communication_settings", "facility_building_profiles"] },
  { key: "emergency_contact", label: "Emergency contact", tables: ["facility_emergency_contacts"] },
  { key: "permission", label: "Permission", tables: [] },
];

export const FACILITY_AUDIT_ACTION_UI = [
  { key: "INSERT", label: "Created" },
  { key: "UPDATE", label: "Updated" },
  { key: "DELETE", label: "Deleted" },
] as const;

/** Scaffold labels — not stored in facility_audit_log today. */
export const FACILITY_AUDIT_ACTION_SCAFFOLD = [
  { key: "VIEWED", label: "Viewed" },
  { key: "EXPORTED", label: "Exported" },
  { key: "LOGIN", label: "Logged in" },
  { key: "PERMISSION", label: "Permission changed" },
] as const;

export type FacilityAuditSourceFilter = "any" | "web" | "api" | "mobile" | "system";

export const FACILITY_AUDIT_SOURCE_OPTIONS: ReadonlyArray<{ value: FacilityAuditSourceFilter; label: string }> = [
  { value: "any", label: "Any source" },
  { value: "web", label: "Web app" },
  { value: "api", label: "API" },
  { value: "mobile", label: "Mobile" },
  { value: "system", label: "System (automated)" },
];

export function entityKeysToTableNames(keys: ReadonlySet<FacilityAuditEntityFilterKey>): string[] {
  const out = new Set<string>();
  for (const opt of FACILITY_AUDIT_ENTITY_OPTIONS) {
    if (keys.has(opt.key)) {
      for (const t of opt.tables) out.add(t);
    }
  }
  return Array.from(out);
}

export function buildFacilityAuditEntityHref(
  facilityId: string,
  tableName: string,
): { href: string; label: string } | null {
  switch (tableName) {
    case "facility_documents":
      return { href: `/admin/facilities/${facilityId}?tab=documents`, label: "Document vault" };
    case "rate_schedule_versions":
      return { href: `/admin/facilities/${facilityId}?tab=rates`, label: "Rates & billing" };
    case "facility_vendors":
      return { href: `/admin/facilities/${facilityId}?tab=vendors`, label: "Vendors" };
    case "facility_emergency_contacts":
      return { href: `/admin/facilities/${facilityId}?tab=emergency`, label: "Emergency contacts" };
    case "facility_building_profiles":
      return { href: `/admin/facilities/${facilityId}?tab=building`, label: "Building & safety" };
    case "facility_operational_thresholds":
      return { href: `/admin/facilities/${facilityId}?tab=thresholds`, label: "Alert thresholds" };
    case "facility_communication_settings":
      return { href: `/admin/facilities/${facilityId}?tab=communication`, label: "Communication" };
    case "facility_timeline_events":
      return { href: `/admin/facilities/${facilityId}?tab=timeline`, label: "Timeline" };
    case "facility_survey_history":
      return { href: `/admin/facilities/${facilityId}?tab=licensing`, label: "Licensing & compliance" };
    default:
      return null;
  }
}

export function formatAuditJsonCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
