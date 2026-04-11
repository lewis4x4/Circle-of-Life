/**
 * Search tool definitions, tier metadata, and RBAC defaults.
 * Single source of truth for the admin search dashboard and search middleware.
 */

// ── Types ────────────────────────────────────────────────────

export type SearchToolTier =
  | "kb_documents"
  | "clinical"
  | "operational"
  | "financial"
  | "payroll";

export type SearchToolDefinition = {
  name: string;
  label: string;
  description: string;
  tier: SearchToolTier;
};

export type SearchAuditEntry = {
  id: string;
  user_id: string;
  user_email: string | null;
  app_role: string;
  tool_name: string;
  tool_tier: SearchToolTier;
  query_text: string | null;
  results_count: number;
  duration_ms: number | null;
  facility_id: string | null;
  created_at: string;
};

export type SearchToolPolicy = {
  id: string;
  organization_id: string;
  tool_name: string;
  tool_tier: SearchToolTier;
  app_role: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

// ── Tool definitions ─────────────────────────────────────────

export const SEARCH_TOOLS: SearchToolDefinition[] = [
  {
    name: "semantic_kb_search",
    label: "Knowledge Base",
    description: "Search facility knowledge base articles and documents",
    tier: "kb_documents",
  },
  {
    name: "resident_lookup",
    label: "Resident Lookup",
    description: "Search residents by name, room, or care status",
    tier: "clinical",
  },
  {
    name: "daily_ops_search",
    label: "Daily Ops",
    description: "Search daily operations logs and shift notes",
    tier: "clinical",
  },
  {
    name: "medication_search",
    label: "Medications",
    description: "Search medication records and eMAR entries",
    tier: "clinical",
  },
  {
    name: "incident_search",
    label: "Incidents",
    description: "Search incident reports and investigations",
    tier: "clinical",
  },
  {
    name: "census_snapshot",
    label: "Census",
    description: "Current census and occupancy data",
    tier: "clinical",
  },
  {
    name: "staff_directory",
    label: "Staff Directory",
    description: "Search staff profiles, certifications, and schedules",
    tier: "operational",
  },
  {
    name: "compliance_search",
    label: "Compliance",
    description: "Search compliance rules, citations, and survey results",
    tier: "operational",
  },
  {
    name: "billing_search",
    label: "Billing",
    description: "Search invoices, payments, and accounts receivable",
    tier: "financial",
  },
  {
    name: "payroll_search",
    label: "Payroll",
    description: "Search payroll records and timesheet data",
    tier: "payroll",
  },
];

// ── Tier metadata ────────────────────────────────────────────

export const TIER_META: Record<
  SearchToolTier,
  { label: string; color: string; bgClass: string; textClass: string }
> = {
  kb_documents: {
    label: "Knowledge Base",
    color: "#8b5cf6",
    bgClass: "bg-violet-500/10 dark:bg-violet-500/20",
    textClass: "text-violet-600 dark:text-violet-400",
  },
  clinical: {
    label: "Clinical",
    color: "#06b6d4",
    bgClass: "bg-cyan-500/10 dark:bg-cyan-500/20",
    textClass: "text-cyan-600 dark:text-cyan-400",
  },
  operational: {
    label: "Operational",
    color: "#f59e0b",
    bgClass: "bg-amber-500/10 dark:bg-amber-500/20",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  financial: {
    label: "Financial",
    color: "#10b981",
    bgClass: "bg-emerald-500/10 dark:bg-emerald-500/20",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  payroll: {
    label: "Payroll",
    color: "#ef4444",
    bgClass: "bg-red-500/10 dark:bg-red-500/20",
    textClass: "text-red-600 dark:text-red-400",
  },
};

// ── Default RBAC matrix ──────────────────────────────────────
// Used to seed policies when an org is created.
// key = tool_name, value = set of roles that have access by default.

export const DEFAULT_TOOL_ACCESS: Record<string, Set<string>> = {
  semantic_kb_search: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator", "admin_assistant"]),
  resident_lookup: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  daily_ops_search: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  medication_search: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  incident_search: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  census_snapshot: new Set(["caregiver", "nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  staff_directory: new Set(["nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator", "admin_assistant"]),
  compliance_search: new Set(["nurse", "facility_admin", "owner", "org_admin", "manager", "coordinator"]),
  billing_search: new Set(["facility_admin", "owner", "org_admin"]),
  payroll_search: new Set(["facility_admin", "owner", "org_admin"]),
};

// ── Display roles for the RBAC matrix grid ───────────────────
// Subset of roles shown in the admin dashboard matrix columns.

export const MATRIX_DISPLAY_ROLES = [
  "caregiver",
  "nurse",
  "coordinator",
  "manager",
  "admin_assistant",
  "facility_admin",
  "org_admin",
  "owner",
] as const;

export type MatrixDisplayRole = (typeof MATRIX_DISPLAY_ROLES)[number];
