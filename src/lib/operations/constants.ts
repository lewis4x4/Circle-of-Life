import type { AppRole } from "@/lib/rbac";

export const OPERATION_CATEGORY_LABELS: Record<string, string> = {
  daily_rounds: "Daily Rounds",
  weekly_rounds: "Weekly Rounds",
  monthly_rounds: "Monthly Rounds",
  quarterly_rounds: "Quarterly Rounds",
  yearly_rounds: "Yearly Rounds",
  audits: "Audits",
  collections: "Collections",
  employee_file: "Employee File",
  mental_health_support: "Mental Health Support",
  safety: "Safety",
  maintenance: "Maintenance",
  compliance: "Compliance",
  financial: "Financial",
  staffing: "Staffing",
  vendor_management: "Vendor Management",
  document_review: "Document Review",
};

export const OPERATION_SHIFT_LABELS: Record<string, string> = {
  day: "Day Shift",
  evening: "Evening Shift",
  night: "Night Shift",
};

export const OPERATIONS_VIEW_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "dietary",
  "maintenance_role",
] as const satisfies readonly AppRole[];

export const OPERATIONS_MUTATION_ADMIN_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "dietary",
  "maintenance_role",
] as const satisfies readonly AppRole[];

export const OPERATIONS_VIEW_ROLE_SET = new Set<AppRole>(OPERATIONS_VIEW_ROLES);
export const OPERATIONS_MUTATION_ADMIN_ROLE_SET = new Set<AppRole>(OPERATIONS_MUTATION_ADMIN_ROLES);

export const ORG_WIDE_OPERATION_ROLES = new Set<AppRole>(["owner", "org_admin"]);

export function isOperationsViewRole(role: string | null | undefined): role is AppRole {
  return Boolean(role) && OPERATIONS_VIEW_ROLE_SET.has(role as AppRole);
}

export const OCE_TEMPLATE_ASSIGNEE_ROLES = [
  "coo",
  "facility_administrator",
  "don",
  "lpn_supervisor",
  "medication_aide",
  "cna",
  "dietary_manager",
  "activities_director",
  "maintenance",
  "housekeeping",
  "staffing_coordinator",
  "compliance_officer",
  "finance_manager",
  "collections_manager",
  "hr_manager",
] as const;

export type OceTemplateAssigneeRole = (typeof OCE_TEMPLATE_ASSIGNEE_ROLES)[number];

export const OCE_ASSIGNEE_ROLE_CROSSWALK: Record<OceTemplateAssigneeRole, AppRole[]> = {
  coo: ["org_admin", "owner"],
  facility_administrator: ["facility_admin", "manager"],
  don: ["nurse", "manager", "facility_admin"],
  lpn_supervisor: ["nurse", "manager", "facility_admin"],
  medication_aide: ["nurse", "caregiver"],
  cna: ["caregiver", "nurse"],
  dietary_manager: ["dietary", "dietary_aide", "manager"],
  activities_director: ["coordinator", "manager"],
  maintenance: ["maintenance_role", "manager"],
  housekeeping: ["housekeeper", "maintenance_role"],
  staffing_coordinator: ["coordinator", "manager"],
  compliance_officer: ["manager", "facility_admin", "org_admin"],
  finance_manager: ["admin_assistant", "manager", "org_admin"],
  collections_manager: ["admin_assistant", "manager", "org_admin"],
  hr_manager: ["admin_assistant", "manager", "org_admin"],
};
