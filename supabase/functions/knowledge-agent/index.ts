/**
 * Knowledge Base — Claude tool-use agent with semantic_kb_search + SSE streaming.
 * Auth: user JWT.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { redactString, redactValue } from "../_shared/redact-pii.ts";
import {
  decideGraceSafeMode,
  formatCountOnlyCensusAnswer,
  getGraceHeaderFacility,
  getGraceUserQuestion,
  isResidentCountOnlyQuestion as isResidentCountOnlyQuestionSafe,
} from "./safe-mode.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL_FULL = "claude-sonnet-4-6";
const MODEL_REDUCED = "claude-haiku-4-5-20251001";
const MAX_ITERATIONS = 6;
const MAX_HISTORY = 12;
const SOFT_CAP_TOKENS = 50_000;
const HARD_CAP_TOKENS = 150_000;

type ToolTier = "kb_documents" | "clinical" | "operational" | "financial" | "payroll";
type GraceIntentKind = "deterministic_summary" | "deterministic_lookup" | "semantic_kb" | "hybrid_cross_domain" | "unsupported";
type GraceDomain =
  | "clarification"
  | "census"
  | "resident_attention"
  | "referral_pipeline"
  | "admissions"
  | "discharge"
  | "medications"
  | "incidents"
  | "compliance"
  | "executive"
  | "family"
  | "finance"
  | "insurance"
  | "vendors"
  | "transport"
  | "training"
  | "dietary"
  | "reputation"
  | "facility_admin"
  | "reporting"
  | "rounding";
type GraceFallbackReason =
  | "no_data"
  | "access_restricted"
  | "domain_not_implemented"
  | "ambiguous_scope"
  | "ambiguous_domain"
  | "ambiguous_time_window"
  | "iteration_cap";
type GraceAnswerMode = "deterministic" | "agentic" | "mixed";

type GraceQueryScope = {
  facilityIds: string[];
  facilityNames: string[];
  entityIds?: string[];
  timeWindowLabel?: string;
  timeWindowStart?: string | null;
  statusFilters?: string[];
  outputShape?: "count" | "list" | "ranked_watchlist" | "brief_summary" | "per_resident" | "per_facility" | "per_entity";
};

type GraceAnswerProvenance = {
  resolved_domain: GraceDomain;
  resolved_scope: GraceQueryScope;
  resolved_time_window: string | null;
  tables_queried: string[];
  rows_examined: number;
  deterministic: boolean;
  fallback_reason: GraceFallbackReason | null;
};

type GraceResolvedRoute = {
  intent_kind: GraceIntentKind;
  domain: GraceDomain;
  scope: GraceQueryScope;
  fallback_mode: GraceFallbackReason | null;
};

type FacilityScopeResolution = GraceQueryScope & {
  accessibleFacilityIds: string[];
  accessibleFacilityNames: string[];
};

type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  tier: ToolTier;
};

type AdminClient = SupabaseClient;

type ToolContext = {
  admin: AdminClient;
  workspaceId: string;
  userRole: string;
  userId: string;
  userEmail: string | null;
  accessibleFacilityIds: string[];
  route?: string;
};

type ResidentLookupRow = {
  id: string;
  facility_id: string;
  bed_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  status: string;
  acuity_level: string | null;
  admission_date: string | null;
  primary_diagnosis: string | null;
  diagnosis_list: string[] | null;
  diet_order: string | null;
  code_status: string;
  fall_risk_level: string | null;
  assistive_device: string | null;
  ambulatory: boolean;
  wandering_risk: boolean;
  elopement_risk: boolean;
  primary_payer: string | null;
  monthly_base_rate: number | null;
  monthly_care_surcharge: number | null;
  monthly_total_rate: number | null;
};

type NamedResidentRow = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
};

type FacilityNameRow = {
  id: string;
  name: string;
};

type ResidentAttentionTaskRow = {
  resident_id: string;
  status: string;
  due_at: string;
};

type ResidentAttentionFollowupRow = {
  resident_id: string | null;
  due_at: string;
  task_type: string;
  description: string;
};

type ResidentAttentionVitalAlertRow = {
  resident_id: string;
  vital_type: string;
  status: string;
  recorded_value: number;
};

type ResidentAttentionCareAlertRow = {
  resident_id: string;
  trigger_type: string;
  status: string;
};

type ReferralLeadSummaryRow = {
  id: string;
  facility_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  referral_sources: { name: string | null } | null;
};

type AdmissionCaseSummaryRow = {
  id: string;
  facility_id: string;
  resident_id: string;
  referral_lead_id: string | null;
  status: string;
  target_move_in_date: string | null;
  financial_clearance_at: string | null;
  physician_orders_received_at: string | null;
  bed_id: string | null;
};

type EmarQueueRow = {
  resident_id: string;
  scheduled_time: string;
  status: string;
  resident_medication_id: string;
};

type MedicationQueueRow = {
  id: string;
  resident_id: string;
  medication_name: string;
  controlled_schedule: string;
};

type ComplianceDeficiencyRow = {
  id: string;
  tag_number: string;
  status: string;
  severity: string;
};

type CompliancePocRow = {
  deficiency_id: string;
  status: string;
  submission_due_date: string;
};

type PolicyDocumentSummaryRow = {
  id: string;
  title: string;
  acknowledgment_due_days: number;
  published_at: string | null;
};

type TrainingCertificationRow = {
  staff_id: string;
  certification_name: string;
  expiration_date: string | null;
  status: string;
};

type TrainingCompletionRow = {
  staff_id: string;
  expires_at: string | null;
  completed_at: string;
};

type TransportRequestSummaryRow = {
  resident_id: string;
  appointment_date: string;
  pickup_time: string | null;
  destination_name: string;
  status: string;
  wheelchair_required: boolean;
};

type DietOrderSummaryRow = {
  resident_id: string;
  status: string;
  iddsi_food_level: string | null;
  iddsi_fluid_level: string | null;
  requires_swallow_eval: boolean;
  medication_texture_review_notes: string | null;
};

type ReputationReplySummaryRow = {
  facility_id: string;
  status: string;
  posted_to_platform_at: string | null;
  review_excerpt: string | null;
  reputation_accounts: { label: string; platform: string } | null;
};

type FamilyMessageSummaryRow = {
  resident_id: string;
  created_at: string;
  author_kind: string;
};

type FamilyTriageSummaryRow = {
  resident_id: string;
  triage_status: string;
};

type ExecutiveAlertSummaryRow = {
  facility_id: string | null;
  entity_id: string | null;
  severity: string;
  title: string;
  why_it_matters: string | null;
  status: string;
};

type FinanceInvoiceSummaryRow = {
  resident_id: string;
  status: string;
  balance_due: number;
  due_date: string;
};

type CollectionActivitySummaryRow = {
  resident_id: string;
  follow_up_date: string | null;
  outcome: string | null;
};

type InsuranceRenewalSummaryRow = {
  id: string;
  entity_id: string;
  insurance_policy_id: string;
  status: string;
  target_effective_date: string;
};

type InsuranceClaimSummaryRow = {
  facility_id: string | null;
  entity_id: string;
  status: string;
  reserve_cents: number;
  paid_cents: number;
};

type VendorContractSummaryRow = {
  vendor_id: string;
  expiration_date: string | null;
  status: string;
};

type VendorPaymentSummaryRow = {
  vendor_id: string;
  amount_cents: number;
  payment_date: string;
};

type VendorSummaryRow = {
  id: string;
  name: string;
};

type ReportingScheduleSummaryRow = {
  id: string;
  facility_id: string | null;
  entity_id: string | null;
  next_run_at: string | null;
  last_error: string | null;
  status: string;
  title_pattern: string;
};

type ReportingRunSummaryRow = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

type ResidentWatchInstanceSummaryRow = {
  resident_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
};

type ResidentEscalationSummaryRow = {
  resident_id: string;
  status: string;
  escalation_type: string;
};

const ALL_APP_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "caregiver",
  "dietary",
  "housekeeper",
  "maintenance_role",
  "family",
  "broker",
] as const;

const FINANCIAL_ROLES = new Set<string>(["owner", "org_admin", "facility_admin"]);

const TIER_ALLOWED_ROLES: Record<ToolTier, Set<string>> = {
  kb_documents: new Set<string>(ALL_APP_ROLES),
  clinical: new Set<string>([
    "owner",
    "org_admin",
    "facility_admin",
    "manager",
    "coordinator",
    "nurse",
    "caregiver",
  ]),
  operational: new Set<string>([
    "owner",
    "org_admin",
    "facility_admin",
    "manager",
    "coordinator",
    "admin_assistant",
    "nurse",
  ]),
  financial: FINANCIAL_ROLES,
  payroll: FINANCIAL_ROLES,
};

const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "semantic_kb_search",
    description:
      "Search uploaded knowledge-base documents such as handbooks, policies, procedures, and compliance references.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        limit: { type: "number", description: "Optional result limit" },
      },
      required: ["query"],
    },
    tier: "kb_documents",
  },
  {
    name: "resident_lookup",
    description:
      "Look up residents by name, room, status, diagnosis, or diet. Returns room and unit details plus current clinical context.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Resident name, room, or clinical search term" },
        limit: { type: "number", description: "Optional result limit" },
      },
      required: ["query"],
    },
    tier: "clinical",
  },
  {
    name: "daily_ops_search",
    description:
      "Search daily logs, ADL records, behavioral logs, condition changes, and shift handoffs for recent operational context.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Resident name or operational search term" },
        limit: { type: "number", description: "Optional per-section result limit" },
      },
      required: ["query"],
    },
    tier: "clinical",
  },
  {
    name: "medication_search",
    description:
      "Look up active medications, recent eMAR administrations, and medication errors for a resident or medication name.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Resident name or medication search term" },
        limit: { type: "number", description: "Optional per-section result limit" },
      },
      required: ["query"],
    },
    tier: "clinical",
  },
  {
    name: "staff_directory",
    description:
      "Search the staff roster by name, role, or facility. Returns staff profile details and current certifications.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Staff name, role, or roster search term" },
        limit: { type: "number", description: "Optional result limit" },
      },
      required: ["query"],
    },
    tier: "operational",
  },
  {
    name: "incident_search",
    description:
      "Search incidents and follow-up tasks by resident, type, severity, location, or status.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Resident name or incident search term" },
        limit: { type: "number", description: "Optional result limit" },
      },
      required: ["query"],
    },
    tier: "clinical",
  },
  {
    name: "compliance_search",
    description:
      "Search survey visits, deficiencies, and plans of correction for compliance status and remediation work.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Agency, tag, deficiency, or plan-of-correction search term" },
        limit: { type: "number", description: "Optional per-section result limit" },
      },
      required: ["query"],
    },
    tier: "operational",
  },
  {
    name: "census_snapshot",
    description:
      "Get the latest census, occupancy, and bed availability snapshot for accessible facilities.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional facility or census question" },
      },
    },
    tier: "clinical",
  },
  {
    name: "billing_search",
    description:
      "Search invoices, payments, and collection activities for resident billing and accounts receivable questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Resident name, invoice number, payer, or billing search term" },
        limit: { type: "number", description: "Optional per-section result limit" },
      },
      required: ["query"],
    },
    tier: "financial",
  },
  {
    name: "payroll_search",
    description:
      "Search payroll export batches and lines by staff, period, provider, or line kind.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Staff name, provider, status, or payroll search term" },
        limit: { type: "number", description: "Optional per-section result limit" },
      },
      required: ["query"],
    },
    tier: "payroll",
  },
];

function withToolCache(tools: ToolDefinition[]) {
  return tools.map((tool, idx) =>
    idx === tools.length - 1
      ? {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
          cache_control: { type: "ephemeral" },
        }
      : {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        },
  );
}

function getAvailableToolsForRole(userRole: string): ToolDefinition[] {
  return TOOL_REGISTRY.filter((tool) => TIER_ALLOWED_ROLES[tool.tier]?.has(userRole));
}

async function applyPolicyOverrides(
  admin: AdminClient,
  workspaceId: string,
  userRole: string,
  tools: ToolDefinition[],
): Promise<ToolDefinition[]> {
  const { data, error } = await admin
    .from("search_tool_policies")
    .select("tool_name, enabled")
    .eq("organization_id", workspaceId)
    .eq("app_role", userRole);

  if (error || !data || data.length === 0) return [];

  const enabledByTool = new Map<string, boolean>();
  for (const row of data as Array<{ tool_name: string; enabled: boolean }>) {
    enabledByTool.set(row.tool_name, row.enabled);
  }

  return tools.filter((tool) => enabledByTool.get(tool.name) === true);
}

function countToolResults(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (!result || typeof result !== "object") return 0;
  const record = result as Record<string, unknown>;
  if (typeof record.count === "number") return record.count;
  if (Array.isArray(record.residents)) return record.residents.length;
  if (Array.isArray(record.batches)) return record.batches.length;
  if (Array.isArray(record.lines)) return record.lines.length;
  if (Array.isArray(record.staff_matches)) return record.staff_matches.length;
  if (record.sections && typeof record.sections === "object") {
    return Object.values(record.sections as Record<string, unknown>).reduce((sum: number, value) => {
      return sum + (Array.isArray(value) ? value.length : 0);
    }, 0);
  }
  return 0;
}

async function logSearchAudit(
  ctx: ToolContext,
  toolName: string,
  toolTier: ToolTier,
  input: Record<string, unknown>,
  result: unknown,
  durationMs: number,
) {
  try {
    await ctx.admin.from("search_audit_log").insert({
      organization_id: ctx.workspaceId,
      facility_id: null,
      user_id: ctx.userId,
      user_email: ctx.userEmail,
      app_role: ctx.userRole,
      tool_name: toolName,
      tool_tier: toolTier,
      query_text:
        typeof input.query === "string"
          ? sanitizeSearchQuery(input.query)
          : typeof input.name === "string"
            ? sanitizeSearchQuery(input.name)
            : null,
      results_count: countToolResults(result),
      duration_ms: durationMs,
    });
  } catch {
    // Non-blocking: audit logging should not break operator search.
  }
}

function sanitizeSearchQuery(value: unknown): string {
  return String(value ?? "")
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecentWindowStart(question: string): Date {
  const q = question.toLowerCase();
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  if (q.includes("today")) return new Date(now.getTime() - msPerDay);
  if (q.includes("yesterday")) return new Date(now.getTime() - 2 * msPerDay);
  if (q.includes("past 30 days") || q.includes("last 30 days") || q.includes("past month") || q.includes("last month")) {
    return new Date(now.getTime() - 30 * msPerDay);
  }
  if (q.includes("past 2 weeks") || q.includes("last 2 weeks") || q.includes("past two weeks") || q.includes("last two weeks")) {
    return new Date(now.getTime() - 14 * msPerDay);
  }
  if (q.includes("past week") || q.includes("last week")) {
    return new Date(now.getTime() - 7 * msPerDay);
  }
  return new Date(now.getTime() - 7 * msPerDay);
}

function getTimeWindowLabel(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("today")) return "today";
  if (q.includes("yesterday")) return "yesterday";
  if (q.includes("past 30 days") || q.includes("last 30 days") || q.includes("past month") || q.includes("last month")) return "past_30_days";
  if (q.includes("past 2 weeks") || q.includes("last 2 weeks") || q.includes("past two weeks") || q.includes("last two weeks")) return "past_14_days";
  if (q.includes("tomorrow")) return "tomorrow";
  if (q.includes("next week")) return "next_week";
  if (q.includes("past week") || q.includes("last week")) return "past_7_days";
  return "past_7_days";
}

function resolveGraceRoute(question: string, scope: GraceQueryScope, accessibleFacilityNames: string[]): GraceResolvedRoute | null {
  const choose = (
    domain: GraceDomain,
    intent_kind: GraceIntentKind = "deterministic_summary",
    fallback_mode: GraceFallbackReason | null = "no_data",
  ): GraceResolvedRoute => ({ domain, intent_kind, scope, fallback_mode });

  const decision = decideGraceSafeMode({
    question,
    accessibleFacilityNames,
  });
  if (decision.kind === "route") return choose(decision.domain);
  return null;
}

function getSearchTokens(value: unknown): string[] {
  const clean = sanitizeSearchQuery(value);
  if (!clean) return [];
  const tokens = clean
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 4);
  return tokens.length > 0 ? tokens : [clean];
}

function buildOrFilter(columns: string[], value: unknown): string | null {
  const tokens = getSearchTokens(value);
  if (tokens.length === 0) return null;
  return tokens
    .flatMap((token) => columns.map((column) => `${column}.ilike.%${token}%`))
    .join(",");
}

function getRequestedLimit(input: Record<string, unknown>, fallback = 8, max = 20): number {
  const raw = Number(input.limit);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), 1), max);
}

function formatResidentName(row: { first_name: string; last_name: string; preferred_name?: string | null }): string {
  if (row.preferred_name && row.preferred_name.trim().length > 0) {
    return `${row.preferred_name} (${row.first_name} ${row.last_name})`;
  }
  return `${row.first_name} ${row.last_name}`;
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function resolveAccessibleFacilityIds(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
  userRole: string,
): Promise<string[]> {
  if (userRole === "owner" || userRole === "org_admin") {
    const { data } = await admin
      .from("facilities")
      .select("id")
      .eq("organization_id", workspaceId)
      .is("deleted_at", null);
    return uniq((data ?? []).map((row: { id: string }) => row.id));
  }

  const { data } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("organization_id", workspaceId)
    .eq("user_id", userId)
    .is("revoked_at", null);

  return uniq((data ?? []).map((row: { facility_id: string }) => row.facility_id));
}

async function resolveRequestedFacilityScope(
  ctx: ToolContext,
  query: string,
): Promise<FacilityScopeResolution> {
  if (ctx.accessibleFacilityIds.length === 0) {
    return {
      facilityIds: [],
      facilityNames: [],
      accessibleFacilityIds: [],
      accessibleFacilityNames: [],
    };
  }

  const { data } = await ctx.admin
    .from("facilities")
    .select("id,name")
    .eq("organization_id", ctx.workspaceId)
    .in("id", ctx.accessibleFacilityIds)
    .is("deleted_at", null);

  const rows = (data ?? []) as FacilityNameRow[];
  if (rows.length === 0) {
    return {
      facilityIds: [],
      facilityNames: [],
      accessibleFacilityIds: [],
      accessibleFacilityNames: [],
    };
  }

  const accessibleFacilityIds = rows.map((row) => row.id);
  const accessibleFacilityNames = rows.map((row) => row.name);
  const headerFacilityName = getGraceHeaderFacility(query);
  const normalizedQuestion = sanitizeSearchQuery(getGraceUserQuestion(query)).toLowerCase();
  const stopWords = new Set(["alf", "at", "the", "facility", "site", "building", "campus"]);
  const scored = rows
    .map((row) => {
      const tokens = sanitizeSearchQuery(row.name)
        .toLowerCase()
        .split(" ")
        .filter((token) => token.length > 2 && !stopWords.has(token));
      const score = tokens.reduce((sum, token) => {
        return sum + (normalizedQuestion.includes(token) ? 1 : 0);
      }, 0);
      const normalizedName = sanitizeSearchQuery(row.name).toLowerCase();
      const directNameMatch =
        normalizedQuestion.includes(normalizedName) ||
        normalizedName.includes(normalizedQuestion);
      return {
        row,
        score: directNameMatch ? Math.max(score, 3) : score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const topScore = scored[0].score;
    const matched = scored
      .filter((entry) => entry.score === topScore)
      .map((entry) => entry.row);
    return {
      facilityIds: matched.map((row) => row.id),
      facilityNames: matched.map((row) => row.name),
      accessibleFacilityIds,
      accessibleFacilityNames,
    };
  }

  if (headerFacilityName) {
    const normalizedHeaderFacility = sanitizeSearchQuery(headerFacilityName).toLowerCase();
    const headerMatch = rows.find((row) => sanitizeSearchQuery(row.name).toLowerCase() === normalizedHeaderFacility);
    if (headerMatch) {
      return {
        facilityIds: [headerMatch.id],
        facilityNames: [headerMatch.name],
        accessibleFacilityIds,
        accessibleFacilityNames,
      };
    }
  }

  return {
    facilityIds: accessibleFacilityIds,
    facilityNames: accessibleFacilityNames,
    accessibleFacilityIds,
    accessibleFacilityNames,
  };
}

function attentionScoreForTaskStatus(status: string): number {
  switch (status) {
    case "critically_overdue":
    case "missed":
    case "escalated":
      return 6;
    case "overdue":
      return 5;
    case "due_now":
      return 4;
    case "due_soon":
      return 3;
    case "reassigned":
      return 2;
    default:
      return 1;
  }
}

async function answerResidentAttentionQuestion(
  ctx: ToolContext,
  facilityScope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (facilityScope.facilityIds.length === 0) {
    return buildDeterministicResult(
      "I don't see any resident attention data for the requested scope.",
      "resident_attention",
      facilityScope,
      ["residents", "resident_observation_tasks", "incident_followups", "vital_sign_alerts", "care_plan_review_alerts"],
      0,
      "no_data",
    );
  }

  const { data: residentsData } = await ctx.admin
    .from("residents")
    .select("id,facility_id,first_name,last_name,preferred_name,status")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityScope.facilityIds)
    .eq("status", "active")
    .is("deleted_at", null);

  const residents = (residentsData ?? []) as Array<{
    id: string;
    facility_id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    status: string;
  }>;
  const residentIds = residents.map((row) => row.id);
  if (residentIds.length === 0) {
    return buildDeterministicResult(
      `I don't see any active residents in ${facilityScope.facilityNames.join(", ")}.`,
      "resident_attention",
      facilityScope,
      ["residents"],
      0,
      "no_data",
    );
  }

  const residentById = new Map(
    residents.map((resident) => [
      resident.id,
      {
        name: formatResidentName(resident),
        facility_id: resident.facility_id,
      },
    ]),
  );
  const facilityNameById = new Map<string, string>();
  facilityScope.facilityNames.forEach((name, index) => {
    const id = facilityScope.facilityIds[index];
    if (id) facilityNameById.set(id, name);
  });

  const nowIso = new Date().toISOString();
  const [
    taskRes,
    followupRes,
    vitalRes,
    careAlertRes,
  ] = await Promise.all([
    ctx.admin
      .from("resident_observation_tasks")
      .select("resident_id,status,due_at")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityScope.facilityIds)
      .in("resident_id", residentIds)
      .is("deleted_at", null)
      .in("status", [
        "due_soon",
        "due_now",
        "overdue",
        "critically_overdue",
        "missed",
        "escalated",
        "reassigned",
      ]),
    ctx.admin
      .from("incident_followups")
      .select("resident_id,due_at,task_type,description")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityScope.facilityIds)
      .is("deleted_at", null)
      .is("completed_at", null)
      .gte("due_at", "1970-01-01T00:00:00Z"),
    ctx.admin
      .from("vital_sign_alerts")
      .select("resident_id,vital_type,status,recorded_value")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityScope.facilityIds)
      .in("resident_id", residentIds)
      .is("deleted_at", null)
      .not("status", "in", "(resolved,dismissed)"),
    ctx.admin
      .from("care_plan_review_alerts")
      .select("resident_id,trigger_type,status")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityScope.facilityIds)
      .in("resident_id", residentIds)
      .is("deleted_at", null)
      .not("status", "in", "(resolved,dismissed)"),
  ]);

  const tasks = (taskRes.data ?? []) as ResidentAttentionTaskRow[];
  const followups = ((followupRes.data ?? []) as ResidentAttentionFollowupRow[]).filter(
    (row) => row.resident_id && residentById.has(row.resident_id),
  );
  const vitalAlerts = (vitalRes.data ?? []) as ResidentAttentionVitalAlertRow[];
  const careAlerts = (careAlertRes.data ?? []) as ResidentAttentionCareAlertRow[];

  const attention = new Map<
    string,
    {
      score: number;
      taskCounts: Record<string, number>;
      overdueFollowups: number;
      upcomingFollowups: number;
      vitalAlerts: ResidentAttentionVitalAlertRow[];
      careAlerts: ResidentAttentionCareAlertRow[];
    }
  >();

  for (const task of tasks) {
    const current = attention.get(task.resident_id) ?? {
      score: 0,
      taskCounts: {},
      overdueFollowups: 0,
      upcomingFollowups: 0,
      vitalAlerts: [],
      careAlerts: [],
    };
    current.taskCounts[task.status] = (current.taskCounts[task.status] ?? 0) + 1;
    current.score += attentionScoreForTaskStatus(task.status);
    attention.set(task.resident_id, current);
  }

  for (const followup of followups) {
    if (!followup.resident_id) continue;
    const current = attention.get(followup.resident_id) ?? {
      score: 0,
      taskCounts: {},
      overdueFollowups: 0,
      upcomingFollowups: 0,
      vitalAlerts: [],
      careAlerts: [],
    };
    if (followup.due_at < nowIso) {
      current.overdueFollowups += 1;
      current.score += 4;
    } else {
      current.upcomingFollowups += 1;
      current.score += 2;
    }
    attention.set(followup.resident_id, current);
  }

  for (const vitalAlert of vitalAlerts) {
    const current = attention.get(vitalAlert.resident_id) ?? {
      score: 0,
      taskCounts: {},
      overdueFollowups: 0,
      upcomingFollowups: 0,
      vitalAlerts: [],
      careAlerts: [],
    };
    current.vitalAlerts.push(vitalAlert);
    current.score += 3;
    attention.set(vitalAlert.resident_id, current);
  }

  for (const careAlert of careAlerts) {
    const current = attention.get(careAlert.resident_id) ?? {
      score: 0,
      taskCounts: {},
      overdueFollowups: 0,
      upcomingFollowups: 0,
      vitalAlerts: [],
      careAlerts: [],
    };
    current.careAlerts.push(careAlert);
    current.score += 2;
    attention.set(careAlert.resident_id, current);
  }

  const ranked = Array.from(attention.entries())
    .filter(([residentId]) => residentById.has(residentId))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 6);

  if (ranked.length === 0) {
    const facilityLabel =
      facilityScope.facilityNames.length === 1
        ? facilityScope.facilityNames[0]
        : "the requested facilities";
    return buildDeterministicResult(
      `I don't see any residents with open attention items in ${facilityLabel}.`,
      "resident_attention",
      facilityScope,
      ["residents", "resident_observation_tasks", "incident_followups", "vital_sign_alerts", "care_plan_review_alerts"],
      residents.length + tasks.length + followups.length + vitalAlerts.length + careAlerts.length,
      "no_data",
    );
  }

  const lines = ranked.map(([residentId, data], index) => {
    const resident = residentById.get(residentId)!;
    const parts: string[] = [];
    if (data.taskCounts.critically_overdue) parts.push(`${data.taskCounts.critically_overdue} critically overdue task${data.taskCounts.critically_overdue > 1 ? "s" : ""}`);
    if (data.taskCounts.overdue) parts.push(`${data.taskCounts.overdue} overdue task${data.taskCounts.overdue > 1 ? "s" : ""}`);
    if (data.taskCounts.due_now) parts.push(`${data.taskCounts.due_now} due now`);
    if (data.taskCounts.due_soon) parts.push(`${data.taskCounts.due_soon} due soon`);
    if (data.taskCounts.missed) parts.push(`${data.taskCounts.missed} missed`);
    if (data.overdueFollowups) parts.push(`${data.overdueFollowups} overdue follow-up${data.overdueFollowups > 1 ? "s" : ""}`);
    if (data.upcomingFollowups) parts.push(`${data.upcomingFollowups} open follow-up${data.upcomingFollowups > 1 ? "s" : ""}`);
    if (data.vitalAlerts.length) {
      const vitalSummary = Array.from(new Set(data.vitalAlerts.map((alert) => alert.vital_type))).slice(0, 2).join(", ");
      parts.push(`${data.vitalAlerts.length} vital alert${data.vitalAlerts.length > 1 ? "s" : ""}${vitalSummary ? ` (${vitalSummary})` : ""}`);
    }
    if (data.careAlerts.length) {
      const alertSummary = Array.from(new Set(data.careAlerts.map((alert) => alert.trigger_type))).slice(0, 2).join(", ");
      parts.push(`${data.careAlerts.length} care-plan alert${data.careAlerts.length > 1 ? "s" : ""}${alertSummary ? ` (${alertSummary})` : ""}`);
    }
    const facilityName = facilityNameById.get(resident.facility_id);
    const suffix = facilityScope.facilityNames.length > 1 && facilityName ? ` — ${facilityName}` : "";
    return `${index + 1}. ${resident.name}${suffix}: ${parts.join("; ")}.`;
  });

  return buildDeterministicResult(
    lines.join("\n"),
    "resident_attention",
    facilityScope,
    ["residents", "resident_observation_tasks", "incident_followups", "vital_sign_alerts", "care_plan_review_alerts"],
    residents.length + tasks.length + followups.length + vitalAlerts.length + careAlerts.length,
  );
}

async function answerCensusSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
  question: string,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const { data: facilitiesData } = await ctx.admin
    .from("facilities")
    .select("id,name,total_licensed_beds")
    .eq("organization_id", ctx.workspaceId)
    .in("id", facilityIds)
    .is("deleted_at", null);

  const facilities = (facilitiesData ?? []) as Array<{
    id: string;
    name: string;
    total_licensed_beds: number | null;
  }>;
  if (facilities.length === 0) {
    return buildDeterministicResult(
      "I could not find facility census data in the requested scope.",
      "census",
      scope,
      ["facilities", "residents"],
      0,
      "no_data",
    );
  }

  const facilityNameById = new Map(facilities.map((row) => [row.id, row.name]));
  const { data: residentsData } = await ctx.admin
    .from("residents")
    .select("facility_id,status")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .eq("status", "active");
  const residentRows = (residentsData ?? []) as Array<{ facility_id: string; status: string }>;

  const counts = new Map<string, number>();
  for (const resident of residentRows) {
    counts.set(resident.facility_id, (counts.get(resident.facility_id) ?? 0) + 1);
  }

  const lines = facilities.map((facility, index) => {
    const activeResidents = counts.get(facility.id) ?? 0;
    const licensedBeds = facility.total_licensed_beds ?? 0;
    const occupancyPct =
      licensedBeds > 0 ? Math.round((activeResidents / licensedBeds) * 100) : null;
    return `${index + 1}. ${facility.name}: ${activeResidents} active resident${activeResidents === 1 ? "" : "s"}${licensedBeds > 0 ? `, ${licensedBeds} licensed beds, ${occupancyPct}% occupancy` : ""}.`;
  });

  const totalResidents = residentRows.length;
  const totalBeds = facilities.reduce((sum, facility) => sum + (facility.total_licensed_beds ?? 0), 0);

  if (isResidentCountOnlyQuestionSafe(question)) {
    const facilityBreakdown = facilities.map((facility) => ({
      name: facility.name,
      activeResidents: counts.get(facility.id) ?? 0,
    }));
    return buildDeterministicResult(
      formatCountOnlyCensusAnswer(facilityBreakdown),
      "census",
      scope,
      ["facilities", "residents"],
      facilities.length + residentRows.length,
    );
  }

  if (facilities.length > 1) {
    return buildDeterministicResult(
      `${totalResidents} active residents are in scope across ${facilities.length} facilities. Total licensed beds in scope: ${totalBeds}.`,
      "census",
      scope,
      ["facilities", "residents"],
      facilities.length + residentRows.length,
    );
  }

  const header =
    facilities.length === 1
      ? `${facilityNameById.get(facilities[0].id) ?? "This facility"} currently has ${totalResidents} active resident${totalResidents === 1 ? "" : "s"}.`
      : `${totalResidents} active residents are in scope across ${facilities.length} facilities.`;

  return buildDeterministicResult(
    `${header}${totalBeds > 0 ? ` Total licensed beds in scope: ${totalBeds}.` : ""}\n\n${lines.join("\n")}`,
    "census",
    scope,
    ["facilities", "residents"],
    facilities.length + residentRows.length,
  );
}

async function answerReferralPipelineQuestion(
  ctx: ToolContext,
  question: string,
  facilityScope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (facilityScope.facilityIds.length === 0) {
    return buildDeterministicResult(
      "I don't see any referral pipeline data for the requested scope.",
      "referral_pipeline",
      facilityScope,
      ["referral_leads", "referral_sources"],
      0,
      "no_data",
    );
  }

  const windowStart = getRecentWindowStart(question);
  const windowStartIso = windowStart.toISOString();

  const { data } = await ctx.admin
    .from("referral_leads")
    .select("id, facility_id, first_name, last_name, preferred_name, status, created_at, updated_at, referral_sources(name)")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityScope.facilityIds)
    .is("deleted_at", null)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(25);

  const leads = (data ?? []) as ReferralLeadSummaryRow[];
  const facilityNameById = new Map<string, string>();
  facilityScope.facilityNames.forEach((name, index) => {
    const id = facilityScope.facilityIds[index];
    if (id) facilityNameById.set(id, name);
  });

  const activeStatuses = new Set([
    "new",
    "contacted",
    "tour_scheduled",
    "tour_completed",
    "application_pending",
    "waitlisted",
  ]);
  const activeLeads = leads.filter((lead) => activeStatuses.has(lead.status));
  const newLeads = leads.filter((lead) => lead.status === "new");
  const convertedLeads = leads.filter((lead) => lead.status === "converted");

  const facilityLabel =
    facilityScope.facilityNames.length === 1
      ? facilityScope.facilityNames[0]
      : "your accessible facilities";
  const windowLabel =
    question.toLowerCase().includes("today")
      ? "today"
      : question.toLowerCase().includes("yesterday")
        ? "yesterday"
        : question.toLowerCase().includes("30")
          ? "the past 30 days"
          : question.toLowerCase().includes("2 week") || question.toLowerCase().includes("two week")
            ? "the past 2 weeks"
            : "the past week";

  if (leads.length === 0) {
    return buildDeterministicResult(
      `I don't see any new referral leads for ${facilityLabel} in ${windowLabel}.`,
      "referral_pipeline",
      facilityScope,
      ["referral_leads", "referral_sources"],
      0,
      "no_data",
    );
  }

  const lines = [
    `${leads.length} lead${leads.length === 1 ? "" : "s"} created in ${windowLabel} for ${facilityLabel}.`,
    `${newLeads.length} new, ${activeLeads.length} active pipeline, ${convertedLeads.length} converted.`,
  ];

  const detailLines = leads.slice(0, 6).map((lead, index) => {
    const residentName = formatResidentName(lead);
    const sourceName = lead.referral_sources?.name?.trim();
    const facilitySuffix =
      facilityScope.facilityNames.length > 1
        ? ` — ${facilityNameById.get(lead.facility_id) ?? lead.facility_id}`
        : "";
    const sourceSuffix = sourceName ? ` via ${sourceName}` : "";
    return `${index + 1}. ${residentName}${facilitySuffix}: ${lead.status.replace(/_/g, " ")}${sourceSuffix}; created ${lead.created_at.slice(0, 10)}.`;
  });

  return buildDeterministicResult(
    [...lines, "", ...detailLines].join("\n"),
    "referral_pipeline",
    facilityScope,
    ["referral_leads", "referral_sources"],
    leads.length,
  );
}

function buildDeterministicResult(
  text: string,
  domain: GraceDomain,
  scope: GraceQueryScope,
  tablesQueried: string[],
  rowsExamined: number,
  fallbackReason: GraceFallbackReason | null = null,
): {
  text: string;
  sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[];
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  kbSearchMiss: boolean;
  clarification_needed?: string | null;
  deterministic: true;
  provenance: GraceAnswerProvenance;
  answer_mode: GraceAnswerMode;
} {
  return {
    text,
    sources: [],
    toolsUsed: [`${domain}_summary`],
    tokensIn: 0,
    tokensOut: 0,
    model: `deterministic:${domain}_summary`,
    kbSearchMiss: false,
    clarification_needed: null,
    deterministic: true,
    answer_mode: "deterministic",
    provenance: {
      resolved_domain: domain,
      resolved_scope: scope,
      resolved_time_window: scope.timeWindowStart ?? null,
      tables_queried: tablesQueried,
      rows_examined: rowsExamined,
      deterministic: true,
      fallback_reason: fallbackReason,
    },
  };
}

function buildClarificationResult(
  text: string,
  scope: GraceQueryScope,
  fallbackReason: Extract<GraceFallbackReason, "ambiguous_scope" | "ambiguous_domain" | "ambiguous_time_window" | "domain_not_implemented">,
): ReturnType<typeof buildDeterministicResult> {
  return {
    ...buildDeterministicResult(
      text,
      "clarification",
      scope,
      [],
      0,
      fallbackReason,
    ),
    toolsUsed: ["clarification_needed"],
    model: "deterministic:clarification",
    clarification_needed: text,
  };
}

async function answerAdmissionsPipelineQuestion(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const { data } = await ctx.admin
    .from("admission_cases")
    .select("id,facility_id,resident_id,referral_lead_id,status,target_move_in_date,financial_clearance_at,physician_orders_received_at,bed_id")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);

  const rows = (data ?? []) as AdmissionCaseSummaryRow[];
  if (rows.length === 0) {
    return buildDeterministicResult(
      "No admission cases are currently open in the requested scope.",
      "admissions",
      scope,
      ["admission_cases"],
      0,
      "no_data",
    );
  }

  const pending = rows.filter((row) => row.status !== "completed" && row.status !== "cancelled");
  const blocked = pending.filter((row) => !row.financial_clearance_at || !row.physician_orders_received_at || !row.bed_id);
  const lines = pending.slice(0, 5).map((row, index) => {
    const blockers: string[] = [];
    if (!row.financial_clearance_at) blockers.push("financial clearance pending");
    if (!row.physician_orders_received_at) blockers.push("physician orders missing");
    if (!row.bed_id) blockers.push("bed assignment missing");
    return `${index + 1}. case ${row.id.slice(0, 8)}: ${row.status.replace(/_/g, " ")}${row.target_move_in_date ? `; target ${row.target_move_in_date}` : ""}${blockers.length ? `; blockers: ${blockers.join(", ")}` : ""}.`;
  });

  return buildDeterministicResult(
    `${pending.length} admission case${pending.length === 1 ? "" : "s"} are open. ${blocked.length} have blockers.\n\n${lines.join("\n")}`,
    "admissions",
    scope,
    ["admission_cases"],
    rows.length,
  );
}

async function answerDischargeWatchlistQuestion(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const { data: residentsData } = await ctx.admin
    .from("residents")
    .select("id,facility_id,first_name,last_name,preferred_name,discharge_target_date,discharge_reason,discharge_destination,status")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .not("discharge_target_date", "is", null)
    .order("discharge_target_date", { ascending: true })
    .limit(20);
  const residents = (residentsData ?? []) as Array<{
    id: string; facility_id: string; first_name: string; last_name: string; preferred_name: string | null;
    discharge_target_date: string | null; discharge_reason: string | null; discharge_destination: string | null; status: string;
  }>;

  const residentIds = residents.map((row) => row.id);
  const { data: medsData } = residentIds.length > 0
    ? await ctx.admin
        .from("discharge_med_reconciliation")
        .select("resident_id,status")
        .eq("organization_id", ctx.workspaceId)
        .in("facility_id", facilityIds)
        .in("resident_id", residentIds)
    : { data: [] };
  const medMap = new Map<string, string>();
  for (const row of (medsData ?? []) as Array<{ resident_id: string; status: string }>) {
    medMap.set(row.resident_id, row.status);
  }

  if (residents.length === 0) {
    return buildDeterministicResult("No pending discharges are currently scheduled in the requested scope.", "discharge", scope, ["residents", "discharge_med_reconciliation"], 0, "no_data");
  }

  const lines = residents.slice(0, 5).map((row, index) => {
    const medStatus = medMap.get(row.id);
    const parts = [`target ${row.discharge_target_date}`];
    if (row.discharge_reason) parts.push(`reason: ${row.discharge_reason.replace(/_/g, " ")}`);
    if (row.discharge_destination) parts.push(`destination: ${row.discharge_destination}`);
    if (medStatus && medStatus !== "completed") parts.push(`med rec ${medStatus.replace(/_/g, " ")}`);
    return `${index + 1}. ${formatResidentName(row)}: ${parts.join("; ")}.`;
  });
  return buildDeterministicResult(`${residents.length} resident${residents.length === 1 ? "" : "s"} have pending discharge targets.\n\n${lines.join("\n")}`, "discharge", scope, ["residents", "discharge_med_reconciliation"], residents.length + (medsData?.length ?? 0));
}

async function answerMedicationQueueQuestion(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const nowIso = new Date().toISOString();
  const { data: emarData } = await ctx.admin
    .from("emar_records")
    .select("resident_id,scheduled_time,status,resident_medication_id")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .in("status", ["scheduled", "held", "refused"])
    .order("scheduled_time", { ascending: true })
    .limit(60);
  const emarRows = (emarData ?? []) as EmarQueueRow[];
  const overdueRows = emarRows.filter((row) => row.scheduled_time < nowIso);
  const medIds = uniq(emarRows.map((row) => row.resident_medication_id));
  const { data: medsData } = medIds.length > 0
    ? await ctx.admin
        .from("resident_medications")
        .select("id,resident_id,medication_name,controlled_schedule")
        .eq("organization_id", ctx.workspaceId)
        .in("id", medIds)
        .is("deleted_at", null)
    : { data: [] };
  const meds = (medsData ?? []) as MedicationQueueRow[];
  const medMap = new Map(meds.map((row) => [row.id, row]));
  const residentNames = await fetchResidentNameMap(ctx, uniq(meds.map((row) => row.resident_id)));

  if (emarRows.length === 0) {
    return buildDeterministicResult("No due or held medication queue items were found in the requested scope.", "medications", scope, ["emar_records", "resident_medications"], 0, "no_data");
  }

  const lines = overdueRows.slice(0, 5).map((row, index) => {
    const med = medMap.get(row.resident_medication_id);
    return `${index + 1}. ${residentNames[row.resident_id] ?? row.resident_id}: ${med?.medication_name ?? "medication"} is ${row.status} since ${row.scheduled_time.slice(11, 16)}${med?.controlled_schedule && med.controlled_schedule !== "non_controlled" ? "; controlled" : ""}.`;
  });
  return buildDeterministicResult(
    `${overdueRows.length} overdue medication queue item${overdueRows.length === 1 ? "" : "s"} and ${emarRows.length - overdueRows.length} upcoming/held item${emarRows.length - overdueRows.length === 1 ? "" : "s"} are in the current queue.\n\n${lines.join("\n")}`,
    "medications",
    scope,
    ["emar_records", "resident_medications"],
    emarRows.length + meds.length,
  );
}

async function answerIncidentFollowupSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const nowIso = new Date().toISOString();
  const [incidentsRes, followupsRes] = await Promise.all([
    ctx.admin
      .from("incidents")
      .select("id,resident_id,incident_number,severity,status,occurred_at")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityIds)
      .is("deleted_at", null)
      .not("status", "in", "(closed,resolved)")
      .order("occurred_at", { ascending: false })
      .limit(20),
    ctx.admin
      .from("incident_followups")
      .select("resident_id,due_at,task_type,description")
      .eq("organization_id", ctx.workspaceId)
      .in("facility_id", facilityIds)
      .is("deleted_at", null)
      .is("completed_at", null)
      .order("due_at", { ascending: true })
      .limit(20),
  ]);
  const incidents = (incidentsRes.data ?? []) as Array<{ id: string; resident_id: string | null; incident_number: string; severity: string; status: string; occurred_at: string }>;
  const followups = (followupsRes.data ?? []) as ResidentAttentionFollowupRow[];
  const residentIds = uniq([
    ...incidents.map((row) => row.resident_id).filter(Boolean) as string[],
    ...followups.map((row) => row.resident_id).filter(Boolean) as string[],
  ]);
  const residentNames = await fetchResidentNameMap(ctx, residentIds);
  const overdue = followups.filter((row) => row.due_at < nowIso);

  if (incidents.length === 0 && followups.length === 0) {
    return buildDeterministicResult("No unresolved incidents or open incident follow-ups were found in the requested scope.", "incidents", scope, ["incidents", "incident_followups"], 0, "no_data");
  }

  const lines = overdue.slice(0, 5).map((row, index) => `${index + 1}. ${row.resident_id ? residentNames[row.resident_id] ?? row.resident_id : "Unlinked resident"}: ${row.task_type.replace(/_/g, " ")} overdue since ${row.due_at.slice(0, 10)}.`);
  return buildDeterministicResult(
    `${incidents.length} unresolved incident${incidents.length === 1 ? "" : "s"} and ${followups.length} open follow-up${followups.length === 1 ? "" : "s"} are active. ${overdue.length} follow-up${overdue.length === 1 ? "" : "s"} are overdue.\n\n${lines.join("\n")}`,
    "incidents",
    scope,
    ["incidents", "incident_followups"],
    incidents.length + followups.length,
  );
}

async function answerComplianceWatchlistSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const nowIso = new Date().toISOString();
  const [defRes, pocRes, policyRes, ackRes] = await Promise.all([
    ctx.admin.from("survey_deficiencies").select("id,tag_number,status,severity").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("status", "in", "(verified,corrected)").limit(20),
    ctx.admin.from("plans_of_correction").select("deficiency_id,status,submission_due_date").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("status", "in", "(accepted,completed)").limit(20),
    ctx.admin.from("policy_documents").select("id,title,acknowledgment_due_days,published_at").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).eq("status", "published").limit(20),
    ctx.admin.from("policy_acknowledgments").select("policy_document_id,user_id").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds),
  ]);
  const deficiencies = (defRes.data ?? []) as ComplianceDeficiencyRow[];
  const pocs = (pocRes.data ?? []) as CompliancePocRow[];
  const overduePocs = pocs.filter((row) => row.submission_due_date < nowIso.slice(0, 10));
  const policies = (policyRes.data ?? []) as PolicyDocumentSummaryRow[];
  const acks = (ackRes.data ?? []) as Array<{ policy_document_id: string; user_id: string }>;
  const unackedPolicies = policies.filter((policy) => {
    if (!policy.published_at) return false;
    const dueDate = new Date(policy.published_at);
    dueDate.setDate(dueDate.getDate() + policy.acknowledgment_due_days);
    return dueDate.toISOString() < nowIso && !acks.some((ack) => ack.policy_document_id === policy.id);
  });
  if (deficiencies.length === 0 && overduePocs.length === 0 && unackedPolicies.length === 0) {
    return buildDeterministicResult("No compliance watchlist items are currently open in the requested scope.", "compliance", scope, ["survey_deficiencies", "plans_of_correction", "policy_documents", "policy_acknowledgments"], 0, "no_data");
  }
  const parts = [
    `${deficiencies.length} open deficiency${deficiencies.length === 1 ? "" : "ies"}`,
    `${overduePocs.length} overdue POC${overduePocs.length === 1 ? "" : "s"}`,
    `${unackedPolicies.length} published polic${unackedPolicies.length === 1 ? "y is" : "ies are"} overdue for acknowledgment`,
  ];
  return buildDeterministicResult(parts.join(", ") + ".", "compliance", scope, ["survey_deficiencies", "plans_of_correction", "policy_documents", "policy_acknowledgments"], deficiencies.length + pocs.length + policies.length + acks.length);
}

async function answerTrainingExpirySummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 30);
  const endIso = windowEnd.toISOString().slice(0, 10);
  const [certRes, completionRes, sessionRes] = await Promise.all([
    ctx.admin.from("staff_certifications").select("staff_id,certification_name,expiration_date,status").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("expiration_date", "is", null).lte("expiration_date", endIso).limit(30),
    ctx.admin.from("staff_training_completions").select("staff_id,expires_at,completed_at").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("expires_at", "is", null).lte("expires_at", endIso).limit(30),
    ctx.admin.from("inservice_log_sessions").select("session_date,topic,hours,facility_id").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).gte("session_date", new Date().toISOString().slice(0, 10)).order("session_date", { ascending: true }).limit(5),
  ]);
  const certs = (certRes.data ?? []) as TrainingCertificationRow[];
  const completions = (completionRes.data ?? []) as TrainingCompletionRow[];
  const sessions = (sessionRes.data ?? []) as Array<{ session_date: string; topic: string; hours: number; facility_id: string }>;
  const staffNames = await fetchStaffNameMap(ctx, uniq([...certs.map((row) => row.staff_id), ...completions.map((row) => row.staff_id)]));
  if (certs.length === 0 && completions.length === 0 && sessions.length === 0) {
    return buildDeterministicResult("No near-term certification expirations, completion expirations, or upcoming in-service sessions were found.", "training", scope, ["staff_certifications", "staff_training_completions", "inservice_log_sessions"], 0, "no_data");
  }
  const lines = [
    `${certs.length} certification expiration${certs.length === 1 ? "" : "s"} in the next 30 days.`,
    `${completions.length} training completion expiration${completions.length === 1 ? "" : "s"} in the next 30 days.`,
  ];
  if (sessions.length > 0) {
    lines.push(`Next in-service: ${sessions[0].topic} on ${sessions[0].session_date}.`);
  }
  const detail = certs.slice(0, 4).map((row, index) => `${index + 1}. ${staffNames[row.staff_id] ?? row.staff_id}: ${row.certification_name} expires ${row.expiration_date}.`);
  return buildDeterministicResult([...lines, "", ...detail].join("\n"), "training", scope, ["staff_certifications", "staff_training_completions", "inservice_log_sessions"], certs.length + completions.length + sessions.length);
}

async function answerTransportScheduleSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const label = scope.timeWindowLabel ?? "today";
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);
  if (label === "tomorrow") {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  } else if (label === "next_week") {
    end.setDate(end.getDate() + 7);
  }
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);
  const req = ctx.admin
    .from("resident_transport_requests")
    .select("resident_id,appointment_date,pickup_time,destination_name,status,wheelchair_required")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .gte("appointment_date", startIso)
    .lte("appointment_date", endIso)
    .order("appointment_date", { ascending: true })
    .limit(20);
  const rows = (await req).data as TransportRequestSummaryRow[] ?? [];
  const residentNames = await fetchResidentNameMap(ctx, uniq(rows.map((row) => row.resident_id)));
  if (rows.length === 0) {
    return buildDeterministicResult(`No transport trips are scheduled for ${label.replace(/_/g, " ")} in the requested scope.`, "transport", scope, ["resident_transport_requests"], 0, "no_data");
  }
  const lines = rows.slice(0, 5).map((row, index) => `${index + 1}. ${residentNames[row.resident_id] ?? row.resident_id}: ${row.destination_name} on ${row.appointment_date}${row.pickup_time ? ` at ${row.pickup_time}` : ""}; ${row.status.replace(/_/g, " ")}${row.wheelchair_required ? "; wheelchair" : ""}.`);
  return buildDeterministicResult(`${rows.length} transport trip${rows.length === 1 ? "" : "s"} are scheduled for ${label.replace(/_/g, " ")}.\n\n${lines.join("\n")}`, "transport", scope, ["resident_transport_requests"], rows.length);
}

async function answerDietaryRiskSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const { data } = await ctx.admin
    .from("diet_orders")
    .select("resident_id,status,iddsi_food_level,iddsi_fluid_level,requires_swallow_eval,medication_texture_review_notes")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .eq("status", "active")
    .limit(30);
  const rows = (data ?? []) as DietOrderSummaryRow[];
  const risky = rows.filter((row) => row.requires_swallow_eval || row.medication_texture_review_notes || row.iddsi_food_level || row.iddsi_fluid_level);
  const residentNames = await fetchResidentNameMap(ctx, uniq(risky.map((row) => row.resident_id)));
  if (risky.length === 0) {
    return buildDeterministicResult("No active dietary risk items were found in the requested scope.", "dietary", scope, ["diet_orders"], 0, "no_data");
  }
  const lines = risky.slice(0, 5).map((row, index) => {
    const parts: string[] = [];
    if (row.iddsi_food_level) parts.push(`food ${row.iddsi_food_level}`);
    if (row.iddsi_fluid_level) parts.push(`fluid ${row.iddsi_fluid_level}`);
    if (row.requires_swallow_eval) parts.push("swallow eval required");
    if (row.medication_texture_review_notes) parts.push("med-texture review flagged");
    return `${index + 1}. ${residentNames[row.resident_id] ?? row.resident_id}: ${parts.join("; ")}.`;
  });
  return buildDeterministicResult(`${risky.length} resident${risky.length === 1 ? "" : "s"} have active dietary risk items.\n\n${lines.join("\n")}`, "dietary", scope, ["diet_orders"], rows.length);
}

async function answerReputationReplyQueueSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const { data } = await ctx.admin
    .from("reputation_replies")
    .select("facility_id,status,posted_to_platform_at,review_excerpt,reputation_accounts(label,platform)")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(25);
  const rows = (data ?? []) as ReputationReplySummaryRow[];
  const pending = rows.filter((row) => row.status === "draft");
  const failed = rows.filter((row) => row.status === "failed");
  if (rows.length === 0) {
    return buildDeterministicResult("No reputation reply records were found in the requested scope.", "reputation", scope, ["reputation_replies", "reputation_accounts"], 0, "no_data");
  }
  const lines = pending.slice(0, 4).map((row, index) => `${index + 1}. ${row.reputation_accounts?.label ?? "Account"} (${row.reputation_accounts?.platform ?? "platform"}): draft reply pending${row.review_excerpt ? ` — "${row.review_excerpt.slice(0, 80)}"` : ""}.`);
  return buildDeterministicResult(`${pending.length} reply draft${pending.length === 1 ? "" : "s"} are waiting and ${failed.length} reply post${failed.length === 1 ? "" : "s"} failed.\n\n${lines.join("\n")}`, "reputation", scope, ["reputation_replies", "reputation_accounts"], rows.length);
}

async function answerFamilyCommunicationSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const windowStartIso = (scope.timeWindowStart ?? getRecentWindowStart("past week").toISOString());
  const [messagesRes, triageRes] = await Promise.all([
    ctx.admin.from("family_portal_messages").select("resident_id,created_at,author_kind").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).gte("created_at", windowStartIso).order("created_at", { ascending: false }).limit(30),
    ctx.admin.from("family_message_triage_items").select("resident_id,triage_status").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("triage_status", "in", "(resolved,dismissed)").limit(30),
  ]);
  const messages = (messagesRes.data ?? []) as FamilyMessageSummaryRow[];
  const triageItems = (triageRes.data ?? []) as FamilyTriageSummaryRow[];
  const residentNames = await fetchResidentNameMap(ctx, uniq([...messages.map((row) => row.resident_id), ...triageItems.map((row) => row.resident_id)]));
  if (messages.length === 0 && triageItems.length === 0) {
    return buildDeterministicResult("No recent family communication hotspots were found in the requested scope.", "family", scope, ["family_portal_messages", "family_message_triage_items"], 0, "no_data");
  }
  const lines = triageItems.slice(0, 5).map((row, index) => `${index + 1}. ${residentNames[row.resident_id] ?? row.resident_id}: triage status ${row.triage_status.replace(/_/g, " ")}.`);
  return buildDeterministicResult(`${messages.length} family message${messages.length === 1 ? "" : "s"} were created in the selected time window and ${triageItems.length} triage item${triageItems.length === 1 ? "" : "s"} remain open.\n\n${lines.join("\n")}`, "family", scope, ["family_portal_messages", "family_message_triage_items"], messages.length + triageItems.length);
}

async function answerExecutiveAlertSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  let req = ctx.admin
    .from("exec_alerts")
    .select("facility_id,entity_id,severity,title,why_it_matters,status")
    .eq("organization_id", ctx.workspaceId)
    .is("deleted_at", null)
    .not("status", "in", "(resolved,dismissed)");
  if (facilityIds.length > 0) req = req.in("facility_id", facilityIds);
  const rows = ((await req.limit(20)).data ?? []) as ExecutiveAlertSummaryRow[];
  if (rows.length === 0) {
    return buildDeterministicResult("No active executive alerts are open in the requested scope.", "executive", scope, ["exec_alerts"], 0, "no_data");
  }
  const critical = rows.filter((row) => row.severity === "critical");
  const high = rows.filter((row) => row.severity === "high");
  const lines = rows.slice(0, 5).map((row, index) => `${index + 1}. [${row.severity}] ${row.title}${row.why_it_matters ? ` — ${row.why_it_matters}` : ""}`);
  return buildDeterministicResult(`${rows.length} executive alert${rows.length === 1 ? "" : "s"} are open: ${critical.length} critical and ${high.length} high.\n\n${lines.join("\n")}`, "executive", scope, ["exec_alerts"], rows.length);
}

async function answerFinanceArSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (!FINANCIAL_ROLES.has(ctx.userRole)) {
    return buildDeterministicResult("I do not have access to billing and AR data for this role.", "finance", scope, ["invoices", "collection_activities"], 0, "access_restricted");
  }
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const [invoiceRes, activityRes] = await Promise.all([
    ctx.admin.from("invoices").select("resident_id,status,balance_due,due_date").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).in("status", ["sent", "partial", "overdue"]).limit(40),
    ctx.admin.from("collection_activities").select("resident_id,follow_up_date,outcome").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).limit(30),
  ]);
  const invoices = (invoiceRes.data ?? []) as FinanceInvoiceSummaryRow[];
  const overdue = invoices.filter((row) => row.status === "overdue");
  const totalBalance = invoices.reduce((sum, row) => sum + (row.balance_due ?? 0), 0);
  const activities = (activityRes.data ?? []) as CollectionActivitySummaryRow[];
  const dueFollowups = activities.filter((row) => row.follow_up_date);
  if (invoices.length === 0) {
    return buildDeterministicResult("No open AR invoices were found in the requested scope.", "finance", scope, ["invoices", "collection_activities"], 0, "no_data");
  }
  return buildDeterministicResult(`${overdue.length} invoice${overdue.length === 1 ? "" : "s"} are overdue. Total open AR is $${(totalBalance / 100).toFixed(2)}. ${dueFollowups.length} collection activit${dueFollowups.length === 1 ? "y has" : "ies have"} a follow-up date on file.`, "finance", scope, ["invoices", "collection_activities"], invoices.length + activities.length);
}

async function answerFinanceCloseSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (!FINANCIAL_ROLES.has(ctx.userRole)) {
    return buildDeterministicResult("I do not have access to GL and close data for this role.", "finance", scope, ["gl_period_closes", "journal_entries"], 0, "access_restricted");
  }
  const [closeRes, journalRes] = await Promise.all([
    ctx.admin.from("gl_period_closes").select("entity_id,period_month,period_year,status").eq("organization_id", ctx.workspaceId).is("deleted_at", null).limit(20),
    ctx.admin.from("journal_entries").select("entity_id,status,posted_at").eq("organization_id", ctx.workspaceId).is("deleted_at", null).limit(40),
  ]);
  const closes = (closeRes.data ?? []) as Array<{ entity_id: string; period_month: number; period_year: number; status: string }>;
  const journals = (journalRes.data ?? []) as Array<{ entity_id: string; status: string; posted_at: string | null }>;
  const drafts = journals.filter((row) => row.status === "draft");
  const blocked = closes.filter((row) => row.status !== "closed");
  if (closes.length === 0 && journals.length === 0) {
    return buildDeterministicResult("No finance close records were found in the requested scope.", "finance", scope, ["gl_period_closes", "journal_entries"], 0, "no_data");
  }
  return buildDeterministicResult(`${blocked.length} GL period close${blocked.length === 1 ? "" : "s"} are not closed and ${drafts.length} journal entr${drafts.length === 1 ? "y is" : "ies are"} still in draft.`, "finance", scope, ["gl_period_closes", "journal_entries"], closes.length + journals.length);
}

async function answerInsuranceRenewalSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (!FINANCIAL_ROLES.has(ctx.userRole)) {
    return buildDeterministicResult("I do not have access to insurance and claims data for this role.", "insurance", scope, ["insurance_policies", "insurance_claims", "insurance_renewals"], 0, "access_restricted");
  }
  const [policyRes, claimRes, renewalRes] = await Promise.all([
    ctx.admin.from("insurance_policies").select("expiration_date,status,carrier_name,policy_type").eq("organization_id", ctx.workspaceId).is("deleted_at", null).limit(30),
    ctx.admin.from("insurance_claims").select("facility_id,entity_id,status,reserve_cents,paid_cents").eq("organization_id", ctx.workspaceId).is("deleted_at", null).not("status", "in", "(closed,denied)").limit(20),
    ctx.admin.from("insurance_renewals").select("id,entity_id,insurance_policy_id,status,target_effective_date").eq("organization_id", ctx.workspaceId).is("deleted_at", null).not("status", "in", "(bound,expired,declined)").limit(20),
  ]);
  const claims = (claimRes.data ?? []) as InsuranceClaimSummaryRow[];
  const renewals = (renewalRes.data ?? []) as InsuranceRenewalSummaryRow[];
  const policies = (policyRes.data ?? []) as Array<{ expiration_date: string; status: string; carrier_name: string; policy_type: string }>;
  const expiringSoon = policies.filter((row) => row.expiration_date <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const openReserve = claims.reduce((sum, row) => sum + row.reserve_cents, 0);
  if (policies.length === 0 && claims.length === 0 && renewals.length === 0) {
    return buildDeterministicResult("No insurance policies, renewals, or open claims were found in the requested scope.", "insurance", scope, ["insurance_policies", "insurance_claims", "insurance_renewals"], 0, "no_data");
  }
  return buildDeterministicResult(`${expiringSoon.length} polic${expiringSoon.length === 1 ? "y expires" : "ies expire"} in the next 30 days, ${renewals.length} renewal${renewals.length === 1 ? "" : "s"} are in progress, and ${claims.length} open claim${claims.length === 1 ? "" : "s"} carry $${(openReserve / 100).toFixed(2)} in reserves.`, "insurance", scope, ["insurance_policies", "insurance_claims", "insurance_renewals"], policies.length + claims.length + renewals.length);
}

async function answerVendorSpendSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  if (!FINANCIAL_ROLES.has(ctx.userRole)) {
    return buildDeterministicResult("I do not have access to vendor financial data for this role.", "vendors", scope, ["contracts", "purchase_orders", "vendor_invoices", "vendor_payments"], 0, "access_restricted");
  }
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const [contractRes, poRes, invoiceRes, paymentRes, vendorRes] = await Promise.all([
    ctx.admin.from("contracts").select("vendor_id,expiration_date,status").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).limit(20),
    ctx.admin.from("purchase_orders").select("vendor_id,status,total_cents").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).in("status", ["submitted", "approved", "partially_received"]).limit(20),
    ctx.admin.from("vendor_invoices").select("vendor_id,status,total_cents,due_date").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).in("status", ["submitted", "approved"]).limit(20),
    ctx.admin.from("vendor_payments").select("vendor_id,amount_cents,payment_date").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).gte("payment_date", getRecentWindowStart("past 30 days").toISOString().slice(0, 10)).limit(30),
    ctx.admin.from("vendors").select("id,name").eq("organization_id", ctx.workspaceId).is("deleted_at", null).limit(50),
  ]);
  const contracts = (contractRes.data ?? []) as VendorContractSummaryRow[];
  const pos = (poRes.data ?? []) as Array<{ vendor_id: string; status: string; total_cents: number }>;
  const invoices = (invoiceRes.data ?? []) as Array<{ vendor_id: string; status: string; total_cents: number; due_date: string }>;
  const payments = (paymentRes.data ?? []) as VendorPaymentSummaryRow[];
  const vendors = (vendorRes.data ?? []) as VendorSummaryRow[];
  const vendorNameMap = new Map(vendors.map((row) => [row.id, row.name]));
  const expiringContracts = contracts.filter((row) => row.expiration_date && row.expiration_date <= new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const pendingApproval = pos.filter((row) => row.status === "submitted").length;
  const recentSpend = payments.reduce((sum, row) => sum + row.amount_cents, 0);
  const invoiceLines = invoices.slice(0, 3).map((row, index) => `${index + 1}. ${vendorNameMap.get(row.vendor_id) ?? row.vendor_id}: ${row.status} invoice due ${row.due_date}.`);
  return buildDeterministicResult(`${expiringContracts.length} vendor contract${expiringContracts.length === 1 ? "" : "s"} expire in the next 45 days, ${pendingApproval} purchase order${pendingApproval === 1 ? "" : "s"} await approval, and recent vendor payments total $${(recentSpend / 100).toFixed(2)}.\n\n${invoiceLines.join("\n")}`, "vendors", scope, ["contracts", "purchase_orders", "vendor_invoices", "vendor_payments", "vendors"], contracts.length + pos.length + invoices.length + payments.length + vendors.length);
}

async function answerReportingScheduleSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const [scheduleRes, runRes] = await Promise.all([
    ctx.admin.from("report_schedules").select("id,facility_id,entity_id,next_run_at,last_error,status,title_pattern").eq("organization_id", ctx.workspaceId).is("deleted_at", null).limit(20),
    ctx.admin.from("report_runs").select("id,status,started_at,completed_at").eq("organization_id", ctx.workspaceId).order("started_at", { ascending: false }).limit(20),
  ]);
  const schedules = (scheduleRes.data ?? []) as ReportingScheduleSummaryRow[];
  const runs = (runRes.data ?? []) as ReportingRunSummaryRow[];
  const failedSchedules = schedules.filter((row) => row.status === "failed");
  const dueSoon = schedules.filter((row) => row.next_run_at && row.next_run_at < new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  const failedRuns = runs.filter((row) => row.status === "failed");
  if (schedules.length === 0 && runs.length === 0) {
    return buildDeterministicResult("No report schedules or recent report runs were found in the requested scope.", "reporting", scope, ["report_schedules", "report_runs"], 0, "no_data");
  }
  const lines = failedSchedules.slice(0, 4).map((row, index) => `${index + 1}. ${row.title_pattern}: schedule status ${row.status}${row.last_error ? ` — ${row.last_error}` : ""}.`);
  return buildDeterministicResult(`${schedules.length} report schedule${schedules.length === 1 ? "" : "s"} are configured. ${dueSoon.length} run in the next 24 hours. ${failedSchedules.length} schedule${failedSchedules.length === 1 ? "" : "s"} and ${failedRuns.length} recent run${failedRuns.length === 1 ? "" : "s"} are in failed state.\n\n${lines.join("\n")}`, "reporting", scope, ["report_schedules", "report_runs"], schedules.length + runs.length);
}

async function answerRoundingWatchSummary(
  ctx: ToolContext,
  scope: GraceQueryScope,
): Promise<ReturnType<typeof buildDeterministicResult>> {
  const facilityIds = scope.facilityIds.length > 0 ? scope.facilityIds : ctx.accessibleFacilityIds;
  const [taskRes, watchRes, escalationRes] = await Promise.all([
    ctx.admin.from("resident_observation_tasks").select("resident_id,status,due_at").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).in("status", ["due_now", "overdue", "critically_overdue", "missed", "escalated"]).limit(30),
    ctx.admin.from("resident_watch_instances").select("resident_id,status,starts_at,ends_at").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).eq("status", "active").limit(20),
    ctx.admin.from("resident_observation_escalations").select("resident_id,status,escalation_type").eq("organization_id", ctx.workspaceId).in("facility_id", facilityIds).is("deleted_at", null).not("status", "in", "(resolved,dismissed)").limit(20),
  ]);
  const tasks = (taskRes.data ?? []) as ResidentAttentionTaskRow[];
  const watches = (watchRes.data ?? []) as ResidentWatchInstanceSummaryRow[];
  const escalations = (escalationRes.data ?? []) as ResidentEscalationSummaryRow[];
  const residentNames = await fetchResidentNameMap(ctx, uniq([...tasks.map((row) => row.resident_id), ...watches.map((row) => row.resident_id), ...escalations.map((row) => row.resident_id)]));
  if (tasks.length === 0 && watches.length === 0 && escalations.length === 0) {
    return buildDeterministicResult("No active rounding/watch items were found in the requested scope.", "rounding", scope, ["resident_observation_tasks", "resident_watch_instances", "resident_observation_escalations"], 0, "no_data");
  }
  const lines = escalations.slice(0, 4).map((row, index) => `${index + 1}. ${residentNames[row.resident_id] ?? row.resident_id}: ${row.escalation_type.replace(/_/g, " ")} (${row.status.replace(/_/g, " ")}).`);
  return buildDeterministicResult(`${watches.length} active watch protocol${watches.length === 1 ? "" : "s"}, ${tasks.length} overdue or due-now observation task${tasks.length === 1 ? "" : "s"}, and ${escalations.length} open escalation${escalations.length === 1 ? "" : "s"} are active.\n\n${lines.join("\n")}`, "rounding", scope, ["resident_observation_tasks", "resident_watch_instances", "resident_observation_escalations"], tasks.length + watches.length + escalations.length);
}

async function fetchResidentMatches(
  ctx: ToolContext,
  query: string,
  limit = 8,
): Promise<ResidentLookupRow[]> {
  if (ctx.accessibleFacilityIds.length === 0) return [];

  const select =
    "id,facility_id,bed_id,first_name,last_name,preferred_name,status,acuity_level,admission_date,primary_diagnosis,diagnosis_list,diet_order,code_status,fall_risk_level,assistive_device,ambulatory,wandering_risk,elopement_risk,primary_payer,monthly_base_rate,monthly_care_surcharge,monthly_total_rate";
  const filters = buildOrFilter(
    ["first_name", "last_name", "preferred_name", "primary_diagnosis", "diet_order"],
    query,
  );

  let req = ctx.admin
    .from("residents")
    .select(select)
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", ctx.accessibleFacilityIds)
    .is("deleted_at", null)
    .limit(limit);

  if (filters) req = req.or(filters);

  const { data } = await req;
  const direct = (data ?? []) as ResidentLookupRow[];
  if (direct.length > 0 || !query) return direct;

  const roomFilter = buildOrFilter(["room_number"], query);
  if (!roomFilter) return [];

  const { data: rooms } = await ctx.admin
    .from("rooms")
    .select("id")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", ctx.accessibleFacilityIds)
    .is("deleted_at", null)
    .or(roomFilter)
    .limit(limit);

  const roomIds = uniq((rooms ?? []).map((row: { id: string }) => row.id));
  if (roomIds.length === 0) return [];

  const { data: beds } = await ctx.admin
    .from("beds")
    .select("current_resident_id")
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", ctx.accessibleFacilityIds)
    .is("deleted_at", null)
    .in("room_id", roomIds);

  const residentIds = uniq(
    (beds ?? [])
      .map((row: { current_resident_id: string | null }) => row.current_resident_id)
      .filter(Boolean) as string[],
  );
  if (residentIds.length === 0) return [];

  const { data: roomResidents } = await ctx.admin
    .from("residents")
    .select(select)
    .eq("organization_id", ctx.workspaceId)
    .in("facility_id", ctx.accessibleFacilityIds)
    .is("deleted_at", null)
    .in("id", residentIds)
    .limit(limit);

  return (roomResidents ?? []) as ResidentLookupRow[];
}

async function fetchResidentNameMap(ctx: ToolContext, residentIds: string[]): Promise<Record<string, string>> {
  const ids = uniq(residentIds);
  if (ids.length === 0) return {};
  let req = ctx.admin
    .from("residents")
    .select("id,first_name,last_name,preferred_name")
    .eq("organization_id", ctx.workspaceId)
    .in("id", ids);
  if (ctx.accessibleFacilityIds.length > 0) {
    req = req.in("facility_id", ctx.accessibleFacilityIds);
  }
  const { data } = await req;
  return Object.fromEntries(
    (data ?? []).map((row: NamedResidentRow) => [row.id, formatResidentName(row)]),
  );
}

async function fetchStaffNameMap(
  ctx: ToolContext,
  staffIds: string[],
): Promise<Record<string, string>> {
  const ids = uniq(staffIds);
  if (ids.length === 0) return {};
  const { data } = await ctx.admin
    .from("staff")
    .select("id,first_name,last_name,preferred_name")
    .eq("organization_id", ctx.workspaceId)
    .in("id", ids);
  return Object.fromEntries(
    ((data ?? []) as Array<{ id: string; first_name: string; last_name: string; preferred_name: string | null }>).map(
      (row) => [row.id, formatResidentName(row)],
    ),
  );
}

async function buildResidentLookupCards(ctx: ToolContext, residents: ResidentLookupRow[]) {
  const bedIds = uniq(residents.map((row) => row.bed_id).filter(Boolean) as string[]);
  const bedsById = new Map<string, { bed_label: string; room_id: string }>();
  const roomsById = new Map<string, { room_number: string; unit_id: string | null }>();
  const unitsById = new Map<string, { name: string }>();

  if (bedIds.length > 0) {
    const { data: beds } = await ctx.admin
      .from("beds")
      .select("id,bed_label,room_id")
      .eq("organization_id", ctx.workspaceId)
      .is("deleted_at", null)
      .in("id", bedIds);
    for (const bed of beds ?? []) {
      bedsById.set(bed.id, bed);
    }
  }

  const roomIds = uniq(Array.from(bedsById.values()).map((row) => row.room_id));
  if (roomIds.length > 0) {
    const { data: rooms } = await ctx.admin
      .from("rooms")
      .select("id,room_number,unit_id")
      .eq("organization_id", ctx.workspaceId)
      .is("deleted_at", null)
      .in("id", roomIds);
    for (const room of rooms ?? []) {
      roomsById.set(room.id, room);
    }
  }

  const unitIds = uniq(
    Array.from(roomsById.values())
      .map((row) => row.unit_id)
      .filter(Boolean) as string[],
  );
  if (unitIds.length > 0) {
    const { data: units } = await ctx.admin
      .from("units")
      .select("id,name")
      .eq("organization_id", ctx.workspaceId)
      .is("deleted_at", null)
      .in("id", unitIds);
    for (const unit of units ?? []) {
      unitsById.set(unit.id, unit);
    }
  }

  return residents.map((resident) => {
    const bed = resident.bed_id ? bedsById.get(resident.bed_id) : null;
    const room = bed ? roomsById.get(bed.room_id) : null;
    const unit = room?.unit_id ? unitsById.get(room.unit_id) : null;
    const card: Record<string, unknown> = {
      resident_id: resident.id,
      resident_name: formatResidentName(resident),
      status: resident.status,
      acuity_level: resident.acuity_level,
      admission_date: resident.admission_date,
      primary_diagnosis: resident.primary_diagnosis,
      diagnosis_list: resident.diagnosis_list,
      diet_order: resident.diet_order,
      code_status: resident.code_status,
      fall_risk_level: resident.fall_risk_level,
      assistive_device: resident.assistive_device,
      ambulatory: resident.ambulatory,
      wandering_risk: resident.wandering_risk,
      elopement_risk: resident.elopement_risk,
      room_number: room?.room_number ?? null,
      bed_label: bed?.bed_label ?? null,
      unit_name: unit?.name ?? null,
    };

    if (FINANCIAL_ROLES.has(ctx.userRole)) {
      card.primary_payer = resident.primary_payer;
      card.monthly_base_rate_cents = resident.monthly_base_rate;
      card.monthly_care_surcharge_cents = resident.monthly_care_surcharge;
      card.monthly_total_rate_cents = resident.monthly_total_rate;
    }

    return card;
  });
}

function buildToolAccessSummary(userRole: string, tools: ToolDefinition[]): string {
  const visible = tools.map((tool) => `- \`${tool.name}\`: ${tool.description}`).join("\n");
  const blocked = (Object.keys(TIER_ALLOWED_ROLES) as ToolTier[])
    .filter((tier) => !TIER_ALLOWED_ROLES[tier].has(userRole))
    .map((tier) => `\`${tier}\``)
    .join(", ");

  return `Current user role: \`${userRole}\`

Available tools for this user:
${visible}

Restricted data tiers for this user: ${blocked || "none"}.`;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const { admin, workspaceId, userRole } = ctx;
  switch (name) {
    case "semantic_kb_search": {
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: query,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!embRes.ok) {
        const errText = await embRes.text();
        return { error: `Embedding API ${embRes.status}: ${errText.slice(0, 500)}` };
      }
      const embData = await embRes.json();
      const embedding = embData?.data?.[0]?.embedding as number[] | undefined;
      if (!embedding?.length) {
        return { error: "Embedding API returned no vector" };
      }

      const { data, error } = await admin.rpc("retrieve_evidence", {
        query_embedding: `[${embedding.join(",")}]`,
        keyword_query: query,
        user_role: userRole,
        match_count: getRequestedLimit(input, 8, 12),
        semantic_threshold: 0.45,
        p_workspace_id: workspaceId,
      });

      if (error) return { error: error.message };

      const rows = (data ?? []) as {
        source_title: string;
        excerpt: string;
        confidence: number;
        section_title: string | null;
      }[];

      if (rows.length > 3) {
        return await rerankResults(rows, query);
      }

      return rows;
    }
    case "resident_lookup": {
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const residents = await fetchResidentMatches(ctx, query, getRequestedLimit(input, 8, 12));
      const cards = await buildResidentLookupCards(ctx, residents);
      return {
        result_type: "resident_lookup",
        count: cards.length,
        residents: cards,
      };
    }
    case "daily_ops_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "daily_ops_search", count: 0, sections: {} };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 6, 12);
      const residentMatches = await fetchResidentMatches(ctx, query, Math.min(limit, 8));
      const residentIds = residentMatches.map((row) => row.id);
      const residentNames = await fetchResidentNameMap(ctx, residentIds);
      const dailyFilter = buildOrFilter(["general_notes", "behavior_notes", "mood"], query);
      const adlFilter = buildOrFilter(["adl_type", "notes", "refusal_reason"], query);
      const behaviorFilter = buildOrFilter(["behavior", "behavior_type", "notes"], query);
      const conditionFilter = buildOrFilter(["change_type", "description", "severity"], query);
      const handoffFilter = buildOrFilter(["outgoing_notes", "incoming_notes"], query);

      let dailyReq = admin
        .from("daily_logs")
        .select("id,resident_id,log_date,shift,mood,general_notes,behavior_notes,sleep_quality")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("log_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) dailyReq = dailyReq.in("resident_id", residentIds);
      else if (dailyFilter) dailyReq = dailyReq.or(dailyFilter);

      let adlReq = admin
        .from("adl_logs")
        .select("id,resident_id,log_date,log_time,shift,adl_type,assistance_level,refused,refusal_reason,notes")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("log_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) adlReq = adlReq.in("resident_id", residentIds);
      else if (adlFilter) adlReq = adlReq.or(adlFilter);

      let behaviorReq = admin
        .from("behavioral_logs")
        .select("id,resident_id,occurred_at,shift,behavior_type,behavior,notes,injury_occurred")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) behaviorReq = behaviorReq.in("resident_id", residentIds);
      else if (behaviorFilter) behaviorReq = behaviorReq.or(behaviorFilter);

      let conditionReq = admin
        .from("condition_changes")
        .select("id,resident_id,reported_at,shift,change_type,severity,description,resolution_notes")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) conditionReq = conditionReq.in("resident_id", residentIds);
      else if (conditionFilter) conditionReq = conditionReq.or(conditionFilter);

      let handoffReq = admin
        .from("shift_handoffs")
        .select("id,handoff_date,outgoing_shift,incoming_shift,outgoing_notes,incoming_notes,unit_id")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("handoff_date", { ascending: false })
        .limit(limit);
      if (handoffFilter) handoffReq = handoffReq.or(handoffFilter);

      const [dailyLogs, adlLogs, behavioralLogs, conditionChanges, handoffs] = await Promise.all([
        dailyReq,
        adlReq,
        behaviorReq,
        conditionReq,
        handoffReq,
      ]);

      return {
        result_type: "daily_ops_search",
        resident_matches: await buildResidentLookupCards(ctx, residentMatches),
        sections: {
          daily_logs: (dailyLogs.data ?? []).map((row: Record<string, unknown>) => ({
            ...row,
            resident_name: row.resident_id ? residentNames[String(row.resident_id)] ?? null : null,
          })),
          adl_logs: (adlLogs.data ?? []).map((row: Record<string, unknown>) => ({
            ...row,
            resident_name: row.resident_id ? residentNames[String(row.resident_id)] ?? null : null,
          })),
          behavioral_logs: (behavioralLogs.data ?? []).map((row: Record<string, unknown>) => ({
            ...row,
            resident_name: row.resident_id ? residentNames[String(row.resident_id)] ?? null : null,
          })),
          condition_changes: (conditionChanges.data ?? []).map((row: Record<string, unknown>) => ({
            ...row,
            resident_name: row.resident_id ? residentNames[String(row.resident_id)] ?? null : null,
          })),
          shift_handoffs: handoffs.data ?? [],
        },
      };
    }
    case "medication_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "medication_search", count: 0 };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 6, 12);
      const residentMatches = await fetchResidentMatches(ctx, query, Math.min(limit, 8));
      const residentIds = residentMatches.map((row) => row.id);
      const medicationFilter = buildOrFilter(["medication_name", "generic_name", "indication"], query);

      let medsReq = admin
        .from("resident_medications")
        .select(
          "id,resident_id,medication_name,generic_name,route,frequency,frequency_detail,status,start_date,end_date,instructions,scheduled_times,pharmacy_name,prescriber_name,prn_reason",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("start_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) medsReq = medsReq.in("resident_id", residentIds);
      else if (medicationFilter) medsReq = medsReq.or(medicationFilter);

      const medsRes = await medsReq;
      const medicationRows = medsRes.data ?? [];
      const medResidentIds = uniq([
        ...residentIds,
        ...medicationRows.map((row: { resident_id: string }) => row.resident_id),
      ]);
      const medIds = uniq(medicationRows.map((row: { id: string }) => row.id));
      const residentNames = await fetchResidentNameMap(ctx, medResidentIds);

      let emarReq = admin
        .from("emar_records")
        .select(
          "id,resident_id,resident_medication_id,scheduled_time,actual_time,status,is_prn,notes,prn_reason_given,prn_effectiveness_result",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("scheduled_time", { ascending: false })
        .limit(limit);
      if (medResidentIds.length > 0) emarReq = emarReq.in("resident_id", medResidentIds);

      let errorReq = admin
        .from("medication_errors")
        .select(
          "id,resident_id,resident_medication_id,occurred_at,error_type,severity,description,immediate_actions,root_cause,reviewed_at",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (medResidentIds.length > 0) errorReq = errorReq.in("resident_id", medResidentIds);

      const [emarRes, errorRes] = await Promise.all([emarReq, errorReq]);

      return {
        result_type: "medication_search",
        resident_matches: await buildResidentLookupCards(ctx, residentMatches),
        active_medications: medicationRows.map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
        recent_emar: (emarRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
        medication_errors: (errorRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
        resident_medication_ids: medIds,
      };
    }
    case "staff_directory": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "staff_directory", count: 0, staff: [] };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 8, 12);
      const filter = buildOrFilter(["first_name", "last_name", "preferred_name", "staff_role", "employment_status"], query);
      let staffReq = admin
        .from("staff")
        .select(
          "id,facility_id,first_name,last_name,preferred_name,staff_role,employment_status,hire_date,is_full_time,email,phone,hourly_rate",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(limit);
      if (filter) staffReq = staffReq.or(filter);

      const { data: staffRows } = await staffReq;
      const staffIds = uniq((staffRows ?? []).map((row: { id: string }) => row.id));
      let certRows: Record<string, unknown>[] = [];
      if (staffIds.length > 0) {
        const { data } = await admin
          .from("staff_certifications")
          .select("id,staff_id,certification_name,certification_type,expiration_date,status")
          .eq("organization_id", workspaceId)
          .in("facility_id", ctx.accessibleFacilityIds)
          .is("deleted_at", null)
          .in("staff_id", staffIds)
          .order("expiration_date", { ascending: true })
          .limit(limit * 3);
        certRows = (data ?? []) as Record<string, unknown>[];
      }
      const certsByStaff = new Map<string, Record<string, unknown>[]>();
      for (const cert of certRows) {
        const staffId = String(cert.staff_id);
        const arr = certsByStaff.get(staffId) ?? [];
        arr.push(cert);
        certsByStaff.set(staffId, arr);
      }

      return {
        result_type: "staff_directory",
        count: (staffRows ?? []).length,
        staff: (staffRows ?? []).map((row: Record<string, unknown>) => {
          const out: Record<string, unknown> = {
            staff_id: row.id,
            staff_name: formatResidentName({
              first_name: String(row.first_name),
              last_name: String(row.last_name),
              preferred_name: (row.preferred_name as string | null) ?? null,
            }),
            staff_role: row.staff_role,
            employment_status: row.employment_status,
            hire_date: row.hire_date,
            is_full_time: row.is_full_time,
            email: row.email,
            phone: row.phone,
            certifications: certsByStaff.get(String(row.id)) ?? [],
          };
          if (FINANCIAL_ROLES.has(ctx.userRole)) {
            out.hourly_rate_cents = row.hourly_rate;
          }
          return out;
        }),
      };
    }
    case "incident_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "incident_search", count: 0 };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 6, 12);
      const residentMatches = await fetchResidentMatches(ctx, query, Math.min(limit, 8));
      const residentIds = residentMatches.map((row) => row.id);
      const incidentFilter = buildOrFilter(
        ["incident_number", "description", "location_description", "severity", "status", "category"],
        query,
      );

      let incidentReq = admin
        .from("incidents")
        .select(
          "id,incident_number,resident_id,occurred_at,category,severity,status,location_description,description,immediate_actions,resolution_notes",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) incidentReq = incidentReq.in("resident_id", residentIds);
      else if (incidentFilter) incidentReq = incidentReq.or(incidentFilter);

      const { data: incidentRows } = await incidentReq;
      const incidents = (incidentRows ?? []) as Array<{ id: string; resident_id: string | null } & Record<string, unknown>>;
      const incidentIds = uniq(incidents.map((row) => row.id));
      const allResidentIds = uniq([
        ...residentIds,
        ...incidents.map((row) => row.resident_id).filter(Boolean) as string[],
      ]);
      const residentNames = await fetchResidentNameMap(ctx, allResidentIds);

      let followups: Record<string, unknown>[] = [];
      if (incidentIds.length > 0) {
        const { data } = await admin
          .from("incident_followups")
          .select("id,incident_id,task_type,description,due_at,completed_at,completion_notes,resident_id")
          .eq("organization_id", workspaceId)
          .in("facility_id", ctx.accessibleFacilityIds)
          .is("deleted_at", null)
          .in("incident_id", incidentIds)
          .order("due_at", { ascending: false })
          .limit(limit * 2);
        followups = (data ?? []) as Record<string, unknown>[];
      }

      return {
        result_type: "incident_search",
        resident_matches: await buildResidentLookupCards(ctx, residentMatches),
        incidents: incidents.map((row) => ({
          ...row,
          resident_name: row.resident_id ? residentNames[row.resident_id] ?? null : null,
        })),
        followups: followups.map((row) => ({
          ...row,
          resident_name: row.resident_id ? residentNames[String(row.resident_id)] ?? null : null,
        })),
      };
    }
    case "compliance_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "compliance_search", count: 0 };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 5, 10);
      const visitFilter = buildOrFilter(["agency", "visit_type", "notes"], query);
      const deficiencyFilter = buildOrFilter(
        ["tag_number", "tag_description", "description", "status", "regulatory_rule_citation"],
        query,
      );
      const pocFilter = buildOrFilter(["corrective_action", "responsible_party", "status", "policy_changes"], query);

      let visitsReq = admin
        .from("compliance_survey_visits")
        .select("id,visit_date,agency,visit_type,notes,facility_id")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("visit_date", { ascending: false })
        .limit(limit);
      if (visitFilter) visitsReq = visitsReq.or(visitFilter);

      let deficienciesReq = admin
        .from("survey_deficiencies")
        .select(
          "id,survey_date,survey_type,surveyor_agency,tag_number,tag_description,description,severity,status,regulatory_rule_citation,facility_id",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("survey_date", { ascending: false })
        .limit(limit);
      if (deficiencyFilter) deficienciesReq = deficienciesReq.or(deficiencyFilter);

      let plansReq = admin
        .from("plans_of_correction")
        .select(
          "id,deficiency_id,status,corrective_action,responsible_party,submission_due_date,completion_target_date,reviewer_notes,facility_id",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("submission_due_date", { ascending: false })
        .limit(limit);
      if (pocFilter) plansReq = plansReq.or(pocFilter);

      const [visits, deficiencies, plans] = await Promise.all([visitsReq, deficienciesReq, plansReq]);

      return {
        result_type: "compliance_search",
        survey_visits: visits.data ?? [],
        deficiencies: deficiencies.data ?? [],
        plans_of_correction: plans.data ?? [],
      };
    }
    case "census_snapshot": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "census_snapshot", snapshots: [], bed_status: [] };
      }
      const { data: facilities } = await admin
        .from("facilities")
        .select("id,name")
        .eq("organization_id", workspaceId)
        .in("id", ctx.accessibleFacilityIds)
        .is("deleted_at", null);
      const facilityNameMap = Object.fromEntries(
        (facilities ?? []).map((row: { id: string; name: string }) => [row.id, row.name]),
      );

      const { data: censusRows } = await admin
        .from("census_daily_log")
        .select(
          "id,facility_id,log_date,total_licensed_beds,occupied_beds,available_beds,hold_beds,maintenance_beds,occupancy_rate,admissions_today,discharges_today",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .order("log_date", { ascending: false })
        .limit(50);

      const latestByFacility = new Map<string, Record<string, unknown>>();
      for (const row of censusRows ?? []) {
        if (!latestByFacility.has(row.facility_id)) {
          latestByFacility.set(row.facility_id, {
            ...row,
            facility_name: facilityNameMap[row.facility_id] ?? row.facility_id,
          });
        }
      }

      const { data: beds } = await admin
        .from("beds")
        .select("facility_id,status")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null);

      const bedSummary = new Map<string, Record<string, number>>();
      for (const row of beds ?? []) {
        const current = bedSummary.get(row.facility_id) ?? {};
        current[row.status] = (current[row.status] ?? 0) + 1;
        bedSummary.set(row.facility_id, current);
      }

      return {
        result_type: "census_snapshot",
        snapshots: Array.from(latestByFacility.values()),
        bed_status: Array.from(bedSummary.entries()).map(([facilityId, counts]) => ({
          facility_id: facilityId,
          facility_name: facilityNameMap[facilityId] ?? facilityId,
          counts,
        })),
      };
    }
    case "billing_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "billing_search", count: 0 };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 6, 12);
      const residentMatches = await fetchResidentMatches(ctx, query, Math.min(limit, 8));
      const residentIds = residentMatches.map((row) => row.id);
      const invoiceFilter = buildOrFilter(["invoice_number", "payer_name", "status", "notes"], query);
      const paymentFilter = buildOrFilter(["payer_name", "reference_number", "notes"], query);
      const activityFilter = buildOrFilter(["activity_type", "description", "outcome"], query);

      let invoicesReq = admin
        .from("invoices")
        .select(
          "id,resident_id,invoice_number,status,invoice_date,due_date,period_start,period_end,payer_name,payer_type,balance_due,amount_paid,total",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("invoice_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) invoicesReq = invoicesReq.in("resident_id", residentIds);
      else if (invoiceFilter) invoicesReq = invoicesReq.or(invoiceFilter);

      let paymentsReq = admin
        .from("payments")
        .select(
          "id,resident_id,invoice_id,payment_date,payment_method,payer_name,payer_type,amount,reference_number,deposited,refunded",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("payment_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) paymentsReq = paymentsReq.in("resident_id", residentIds);
      else if (paymentFilter) paymentsReq = paymentsReq.or(paymentFilter);

      let activitiesReq = admin
        .from("collection_activities")
        .select(
          "id,resident_id,invoice_id,activity_date,activity_type,description,outcome,follow_up_date,follow_up_notes",
        )
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("activity_date", { ascending: false })
        .limit(limit);
      if (residentIds.length > 0) activitiesReq = activitiesReq.in("resident_id", residentIds);
      else if (activityFilter) activitiesReq = activitiesReq.or(activityFilter);

      const [invoiceRes, paymentRes, activityRes] = await Promise.all([invoicesReq, paymentsReq, activitiesReq]);
      const allResidentIds = uniq([
        ...residentIds,
        ...((invoiceRes.data ?? []).map((row: { resident_id: string }) => row.resident_id)),
        ...((paymentRes.data ?? []).map((row: { resident_id: string }) => row.resident_id)),
        ...((activityRes.data ?? []).map((row: { resident_id: string }) => row.resident_id)),
      ]);
      const residentNames = await fetchResidentNameMap(ctx, allResidentIds);

      return {
        result_type: "billing_search",
        resident_matches: await buildResidentLookupCards(ctx, residentMatches),
        invoices: (invoiceRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
        payments: (paymentRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
        collection_activities: (activityRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          resident_name: residentNames[String(row.resident_id)] ?? null,
        })),
      };
    }
    case "payroll_search": {
      if (ctx.accessibleFacilityIds.length === 0) {
        return { result_type: "payroll_search", count: 0 };
      }
      const query = sanitizeSearchQuery(input.query);
      if (!query) return { error: "Query is required" };
      const limit = getRequestedLimit(input, 6, 12);
      const staffFilter = buildOrFilter(["first_name", "last_name", "preferred_name"], query);
      let staffReq = admin
        .from("staff")
        .select("id,first_name,last_name,preferred_name")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .limit(limit);
      if (staffFilter) staffReq = staffReq.or(staffFilter);
      const { data: staffRows } = await staffReq;
      const staffIds = uniq((staffRows ?? []).map((row: { id: string }) => row.id));
      const staffNames = Object.fromEntries(
        ((staffRows ?? []) as Array<{ id: string; first_name: string; last_name: string; preferred_name: string | null }>).map(
          (row) => [row.id, formatResidentName(row)],
        ),
      );

      const batchFilter = buildOrFilter(["provider", "status", "notes"], query);
      let batchesReq = admin
        .from("payroll_export_batches")
        .select("id,facility_id,period_start,period_end,provider,status,notes,created_at")
        .eq("organization_id", workspaceId)
        .in("facility_id", ctx.accessibleFacilityIds)
        .is("deleted_at", null)
        .order("period_end", { ascending: false })
        .limit(limit);
      if (batchFilter) batchesReq = batchesReq.or(batchFilter);

      let linesReq = admin
        .from("payroll_export_lines")
        .select("id,batch_id,staff_id,line_kind,amount_cents,payload,created_at")
        .eq("organization_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (staffIds.length > 0) linesReq = linesReq.in("staff_id", staffIds);
      else {
        const lineFilter = buildOrFilter(["line_kind"], query);
        if (lineFilter) linesReq = linesReq.or(lineFilter);
      }

      const [batchRes, lineRes] = await Promise.all([batchesReq, linesReq]);
      const lineStaffIds = uniq(
        ((lineRes.data ?? []) as Array<{ staff_id: string }>).map((row) => row.staff_id),
      );
      const missingStaffIds = lineStaffIds.filter((id: string) => !staffNames[id]);
      const extraStaffNames = await fetchStaffNameMap(ctx, missingStaffIds);

      return {
        result_type: "payroll_search",
        staff_matches: ((staffRows ?? []) as Array<{ id: string }>).map((row) => ({
          staff_id: row.id,
          staff_name: staffNames[row.id],
        })),
        batches: batchRes.data ?? [],
        lines: (lineRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          staff_name: staffNames[String(row.staff_id)] ?? extraStaffNames[String(row.staff_id)] ?? null,
        })),
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function rerankResults(
  results: {
    source_title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[],
  query: string,
): Promise<typeof results> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Given the query "${query}", rank these search results from most to least relevant. Return ONLY a JSON array of indices (0-based), most relevant first. No explanation.\n\nResults:\n${results.map((r, i) => `[${i}] ${r.source_title}: ${r.excerpt?.slice(0, 200)}`).join("\n")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return results;
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    const indices = JSON.parse(text) as unknown;
    if (Array.isArray(indices)) {
      return indices.map((i: number) => results[i]).filter(Boolean);
    }
  } catch {
    /* fallback */
  }
  return results;
}

/**
 * Chunk assistant text for SSE. Must include any trailing fragment that does not end in . ! ?
 * (the old regex-only loop dropped that tail, so the UI sometimes showed nothing).
 */
function chunkTextForStream(text: string): string[] {
  if (!text) return [];
  const re = /[^.!?]+[.!?]+(?:\s|$)/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    parts.push(m[0]);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    if (tail.trim()) parts.push(tail);
  }
  return parts.length > 0 ? parts : [text];
}

function buildSystemPrompt(userRole: string, tools: ToolDefinition[]): string {
  return buildSystemPromptWithEvidence(userRole, tools, null, undefined);
}

function buildSystemPromptWithEvidence(
  userRole: string,
  tools: ToolDefinition[],
  preloadedEvidence: string | null,
  route: string | undefined,
): string {
  return `You are the role-governed Haven knowledge assistant for Circle of Life.

${buildToolAccessSummary(userRole, tools)}

${route ? `Current operator route: ${route}` : ""}

${preloadedEvidence ? `Pre-loaded evidence:\n${preloadedEvidence}\n` : ""}

How to think:
1. Read the user question.
2. Check the pre-loaded evidence first. If it already answers the question, answer directly without calling more tools.
3. Use live-data tools for resident, medication, daily-ops, incident, census, staff, compliance, billing, or payroll questions.
4. Use \`semantic_kb_search\` for uploaded policies, handbooks, SOPs, and compliance reference documents.
5. Read each tool result carefully and answer directly in plain language.

Hard rules:
- All tools are READ-ONLY. Never mutate data.
- Never invent data. If the needed data is not available from your allowed tools, say so clearly.
- If the question is ambiguous, ask a short clarifying question instead of guessing.
- Never answer from an unrelated module just because the current route suggests it.
- Treat the current route as a weak UI hint only, not as authority over the user's words.
- Do not reveal or infer data from blocked tiers. If the user asks for financial or payroll data and those tools are unavailable to this role, say you do not have access.
- Cite sources inline when drawing from \`semantic_kb_search\` results.
- Live operational answers can cite the tool and the returned records in plain language; do not fabricate a document citation.
- If \`semantic_kb_search\` returns no rows, tell the user to upload documents under **Admin → Knowledge → Knowledge admin** (\`/admin/knowledge/admin\`).
- Keep responses concise and operationally useful.`;
}

async function preloadKnowledgeEvidence(
  question: string,
  ctx: ToolContext,
): Promise<{
  evidenceText: string | null;
  sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[];
}> {
  const raw = await executeTool("semantic_kb_search", { query: question, limit: 4 }, ctx);
  if (!Array.isArray(raw) || raw.length === 0) {
    return { evidenceText: null, sources: [] };
  }

  const rows = raw as {
    source_title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[];

  const sources = rows.map((row) => ({
    title: row.source_title,
    excerpt: row.excerpt,
    confidence: row.confidence,
    section_title: row.section_title,
  }));

  const evidenceText = rows
    .map((row, index) =>
      `${index + 1}. ${row.source_title}${row.section_title ? ` — ${row.section_title}` : ""}\n${row.excerpt}`,
    )
    .join("\n\n");

  return { evidenceText, sources };
}

async function runAgentLoop(
  question: string,
  conversationHistory: { role: string; content: unknown }[],
  ctx: ToolContext,
  tools: ToolDefinition[],
): Promise<{
  text: string;
  sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[];
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  kbSearchMiss: boolean;
  clarification_needed?: string | null;
  deterministic?: boolean;
  provenance?: GraceAnswerProvenance;
  answer_mode?: GraceAnswerMode;
}> {
  const resolvedScope = await resolveRequestedFacilityScope(ctx, question);
  const routeScope: GraceQueryScope = {
    facilityIds: resolvedScope.facilityIds,
    facilityNames: resolvedScope.facilityNames,
    timeWindowLabel: getTimeWindowLabel(question),
    timeWindowStart: getRecentWindowStart(question).toISOString(),
  };
  const safeModeDecision = decideGraceSafeMode({
    question,
    accessibleFacilityNames: resolvedScope.accessibleFacilityNames,
  });
  if (safeModeDecision.kind === "clarify") {
    return buildClarificationResult(
      safeModeDecision.text,
      routeScope,
      safeModeDecision.reason,
    );
  }

  const route = resolveGraceRoute(question, routeScope, resolvedScope.accessibleFacilityNames);

  if (route) {
    switch (route.domain) {
      case "census":
        return await answerCensusSummary(ctx, route.scope, question);
      case "referral_pipeline":
        return await answerReferralPipelineQuestion(ctx, question, route.scope);
      case "resident_attention":
        return await answerResidentAttentionQuestion(ctx, route.scope);
      default:
        break;
    }
  }

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let model = MODEL_FULL;
  const toolsUsed: string[] = [];
  let kbSearchUsed = false;
  const sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[] = [];
  const preloadedEvidence = tools.some((tool) => tool.name === "semantic_kb_search")
    ? await preloadKnowledgeEvidence(question, ctx)
    : { evidenceText: null, sources: [] };
  sources.push(...preloadedEvidence.sources);

  const messages: Array<{ role: string; content: unknown }> = [
    ...conversationHistory.slice(-MAX_HISTORY),
    { role: "user", content: question },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (totalTokensIn + totalTokensOut > SOFT_CAP_TOKENS) {
      model = MODEL_REDUCED;
    }
    if (totalTokensIn + totalTokensOut > HARD_CAP_TOKENS) {
      break;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: [{
          type: "text",
          text: buildSystemPromptWithEvidence(ctx.userRole, tools, preloadedEvidence.evidenceText, ctx.route),
          cache_control: { type: "ephemeral" },
        }],
        tools: withToolCache(tools),
        messages,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }

    const result = await response.json();
    totalTokensIn += result.usage?.input_tokens ?? 0;
    totalTokensOut += result.usage?.output_tokens ?? 0;

    if (result.stop_reason === "end_turn") {
      const textBlock = result.content.find((b: { type: string }) => b.type === "text");
      return {
        text: textBlock?.text ?? "I wasn't able to generate a response.",
        sources,
        toolsUsed,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        model,
        kbSearchMiss: kbSearchUsed && sources.length === 0,
      };
    }

    if (result.stop_reason === "tool_use") {
      const assistantMessage = { role: "assistant", content: result.content };
      messages.push(assistantMessage);

      const toolResults: unknown[] = [];
      for (const block of result.content as { type: string; name?: string; id?: string; input?: Record<string, unknown> }[]) {
        if (block.type !== "tool_use") continue;

        toolsUsed.push(block.name!);
        if (block.name === "semantic_kb_search") kbSearchUsed = true;
        const toolStartedAt = Date.now();
        const toolResult = await executeTool(block.name!, block.input ?? {}, ctx);
        const toolDef = TOOL_REGISTRY.find((tool) => tool.name === block.name);
        if (toolDef) {
          await logSearchAudit(
            ctx,
            toolDef.name,
            toolDef.tier,
            block.input ?? {},
            toolResult,
            Date.now() - toolStartedAt,
          );
        }

        if (block.name === "semantic_kb_search" && Array.isArray(toolResult)) {
          sources.push(
            ...toolResult.map((r: { source_title: string; excerpt: string; confidence: number; section_title: string | null }) => ({
              title: r.source_title,
              excerpt: r.excerpt,
              confidence: r.confidence,
              section_title: r.section_title,
            })),
          );
        }

        const resultStr = JSON.stringify(toolResult);
        const truncated = resultStr.length > 8192 ? resultStr.slice(0, 8192) + "..." : resultStr;

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: truncated,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return {
    text:
      "I’m not confident I can answer that cleanly yet. Narrow it to one lane, for example: resident count, new leads, or who needs attention.",
    sources,
    toolsUsed,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    model,
    kbSearchMiss: kbSearchUsed && sources.length === 0,
    clarification_needed: null,
    deterministic: false,
    answer_mode: "agentic",
    provenance: route
      ? {
          resolved_domain: route.domain,
          resolved_scope: route.scope,
          resolved_time_window: route.scope.timeWindowStart ?? null,
          tables_queried: [],
          rows_examined: 0,
          deterministic: false,
          fallback_reason: "iteration_cap",
        }
      : undefined,
  };
}

Deno.serve(async (req) => {
  const t = withTiming("knowledge-agent");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    t.log({ event: "auth_failed", outcome: "blocked" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const userRole = profile?.app_role ?? "caregiver";
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }

  let body: { message?: string; conversation_id?: string; workspace_id?: string; grace?: boolean; route?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const { message, conversation_id, workspace_id: bodyWorkspaceId, grace, route } = body;

  if (!message?.trim()) {
    return jsonResponse({ error: "Message required" }, 400, origin);
  }

  const workspaceId = bodyWorkspaceId && bodyWorkspaceId === orgId ? bodyWorkspaceId : orgId;
  const traceId = crypto.randomUUID();
  const accessibleFacilityIds = await resolveAccessibleFacilityIds(admin, workspaceId, user.id, userRole);
  const availableTools = await applyPolicyOverrides(
    admin,
    workspaceId,
    userRole,
    getAvailableToolsForRole(userRole),
  );
  const toolContext: ToolContext = {
    admin,
    workspaceId,
    userRole,
    userId: user.id,
    userEmail: user.email ?? null,
    accessibleFacilityIds,
    route,
  };

  const conversationTable = grace ? "grace_conversations" : "chat_conversations";
  const messageTable = grace ? "grace_messages" : "chat_messages";
  const usageRpc = grace ? "grace_increment_usage" : "increment_usage";
  const assistantRole = grace ? "grace" : "assistant";

  let conversationId = conversation_id;
  if (!conversationId) {
    const { data: conv, error: convErr } = await admin
      .from(conversationTable)
      .insert(
        grace
          ? {
            organization_id: workspaceId,
            user_id: user.id,
            input_mode: "text",
            route_at_start: route ?? null,
            metadata: {},
          }
          : {
            workspace_id: workspaceId,
            user_id: user.id,
            title: message.slice(0, 100),
          },
      )
      .select("id")
      .single();
    if (convErr || !conv?.id) {
      t.log({ event: "conv_create_failed", outcome: "error", error_message: convErr?.message });
      return jsonResponse({ error: "Could not create conversation" }, 500, origin);
    }
    conversationId = conv.id;
  } else {
    const { data: existingConv, error: convLookupErr } = await admin
      .from(conversationTable)
      .select(grace ? "id, user_id, organization_id" : "id, user_id, workspace_id")
      .eq("id", conversationId)
      .maybeSingle();
    const existingConversation = existingConv as
      | { id: string; user_id: string; organization_id: string }
      | { id: string; user_id: string; workspace_id: string };
    if (convLookupErr || !existingConv) {
      t.log({ event: "conv_not_found", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Conversation not found" }, 404, origin);
    }
    if (existingConversation.user_id !== user.id) {
      t.log({ event: "conv_forbidden_user", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Forbidden" }, 403, origin);
    }
    if ((grace
      ? (existingConversation as { organization_id: string }).organization_id
      : (existingConversation as { workspace_id: string }).workspace_id) !== workspaceId) {
      t.log({ event: "conv_forbidden_org", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Forbidden" }, 403, origin);
    }
  }

  let history: { role: string; content: unknown }[] = [];
  if (conversationId) {
    const { data: msgs } = await admin
      .from(messageTable)
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY);
    history = (msgs ?? []).map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const logInsertError = (context: string, error: { message: string } | null) => {
        if (error) {
          t.log({
            event: "chat_messages_insert_failed",
            outcome: "error",
            trace_id: traceId,
            context,
            error_message: error.message,
          });
        }
      };

      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              meta: { trace_id: traceId, conversation_id: conversationId, model: MODEL_FULL },
            })}\n\n`,
          ),
        );

        const result = await runAgentLoop(message, history, toolContext, availableTools);

        const outgoing =
          result.text.trim().length > 0
            ? chunkTextForStream(result.text)
            : [
                "I did not get a text answer from the model. Please try again, or rephrase your question.",
              ];
        for (const chunk of outgoing) {
          if (chunk.length === 0) continue;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        if (result.sources.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: result.sources })}\n\n`));
        }

        const userMessageBase = grace
          ? {
            conversation_id: conversationId,
            organization_id: workspaceId,
            user_id: user.id,
            role: "user",
            content: redactString(message),
          }
          : {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "user",
            content: message,
            trace_id: traceId,
          };
        const assistantMessageBase = grace
          ? {
            conversation_id: conversationId,
            organization_id: workspaceId,
            user_id: user.id,
            role: assistantRole,
            content: redactString(result.text),
            sources: result.sources.length > 0 ? redactValue(result.sources) : null,
            classifier_output: redactValue({
              model: result.model,
              tools_used: result.toolsUsed,
              iterations: result.toolsUsed.length,
              clarification_needed: result.clarification_needed ?? null,
              answer_mode: result.answer_mode ?? null,
              provenance: result.provenance ?? null,
            }),
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            model: result.model,
            trace_id: traceId,
          }
          : {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "assistant",
            content: result.text,
            sources: result.sources.length > 0 ? result.sources : null,
            classifier_output: {
              model: result.model,
              tools_used: result.toolsUsed,
              iterations: result.toolsUsed.length,
              clarification_needed: result.clarification_needed ?? null,
              answer_mode: result.answer_mode ?? null,
              provenance: result.provenance ?? null,
            },
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            model: result.model,
            trace_id: traceId,
          };

        const { error: insertErr } = await admin.from(messageTable).insert([
          userMessageBase,
          assistantMessageBase,
        ]);
        logInsertError("success_path", insertErr);

        const usageArgs = grace
          ? {
            p_user_id: user.id,
            p_organization_id: workspaceId,
            p_tokens_in: result.tokensIn,
            p_tokens_out: result.tokensOut,
          }
          : {
            p_user_id: user.id,
            p_workspace_id: workspaceId,
            p_tokens_in: result.tokensIn,
            p_tokens_out: result.tokensOut,
          };
        const { error: usageErr } = await admin.rpc(usageRpc, usageArgs);
        if (usageErr) {
          t.log({
            event: "increment_usage_failed",
            outcome: "error",
            trace_id: traceId,
            error_message: usageErr.message,
          });
        }

        if (result.kbSearchMiss) {
          const { error: gapErr } = await admin.rpc("log_knowledge_gap", {
            p_workspace_id: workspaceId,
            p_user_id: user.id,
            p_question: message,
            p_trace_id: traceId,
          });
          if (gapErr) {
            t.log({
              event: "log_knowledge_gap_failed",
              outcome: "error",
              trace_id: traceId,
              error_message: gapErr.message,
            });
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kb_empty: true })}\n\n`));
        }

        const { error: analyticsErr } = await admin.from("kb_analytics_events").insert({
          workspace_id: workspaceId,
          event_type: "chat_query",
          user_id: user.id,
          metadata: {
            trace_id: traceId,
            tools_used: result.toolsUsed,
            source_count: result.sources.length,
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
          },
        });
        if (analyticsErr) {
          t.log({
            event: "kb_analytics_insert_failed",
            outcome: "error",
            trace_id: traceId,
            error_message: analyticsErr.message,
          });
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        t.log({ event: "chat_ok", outcome: "success", trace_id: traceId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));

        const { error: insertErr } = await admin.from(messageTable).insert([
          grace
            ? {
              conversation_id: conversationId,
              organization_id: workspaceId,
              user_id: user.id,
              role: "user",
              content: redactString(message),
            }
            : {
              conversation_id: conversationId,
              workspace_id: workspaceId,
              user_id: user.id,
              role: "user",
              content: message,
              trace_id: traceId,
            },
          grace
            ? {
              conversation_id: conversationId,
              organization_id: workspaceId,
              user_id: user.id,
              role: assistantRole,
              content: `Error: ${redactString(msg)}`,
              trace_id: traceId,
            }
            : {
              conversation_id: conversationId,
              workspace_id: workspaceId,
              user_id: user.id,
              role: "assistant",
              content: `Error: ${msg}`,
              trace_id: traceId,
            },
        ]);
        logInsertError("error_path", insertErr);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        t.log({ event: "chat_error", outcome: "error", error_message: msg });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...getCorsHeaders(origin),
    },
  });
});
