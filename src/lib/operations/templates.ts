import {
  OCE_CADENCE_TYPES,
  OCE_PRIORITY_LEVELS,
  OCE_SHIFT_SCOPES,
  OCE_TEMPLATE_ASSIGNEE_ROLES,
  OPERATION_CATEGORY_LABELS,
  type OceCadenceType,
  type OcePriorityLevel,
  type OceShiftScope,
  type OceTemplateAssigneeRole,
} from "@/lib/operations/constants";

export type OperationTemplateScope = "org" | "facility";

export type OperationEscalationStep = {
  role: string;
  sla_minutes: number;
  channel: string;
  enabled: boolean;
};

export type OperationTemplateRecord = {
  id: string;
  facility_id: string | null;
  name: string;
  description: string;
  category: string;
  cadence_type: OceCadenceType;
  shift_scope: OceShiftScope | null;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  assignee_role: OceTemplateAssigneeRole | null;
  required_role_fallback: string | null;
  escalation_ladder: OperationEscalationStep[];
  asset_ref: string | null;
  vendor_booking_ref: string | null;
  linked_document_id: string | null;
  priority: OcePriorityLevel;
  license_threatening: boolean;
  compliance_requirement: string | null;
  survey_readiness_impact: boolean;
  requires_dual_sign: boolean;
  estimated_minutes: number | null;
  auto_complete_after_hours: number | null;
  is_active: boolean;
  version: number;
  previous_version_id: string | null;
  created_at: string;
  updated_at: string;
  facility_name?: string | null;
  asset_name?: string | null;
  vendor_name?: string | null;
};

export type OperationTemplateMutationPayload = {
  facility_id?: string | null;
  name?: string;
  description?: string;
  category?: string;
  cadence_type?: string;
  shift_scope?: string | null;
  day_of_week?: number | null;
  day_of_month?: number | null;
  month_of_year?: number | null;
  assignee_role?: string | null;
  required_role_fallback?: string | null;
  escalation_ladder?: unknown;
  asset_ref?: string | null;
  vendor_booking_ref?: string | null;
  linked_document_id?: string | null;
  priority?: string;
  license_threatening?: boolean;
  compliance_requirement?: string | null;
  survey_readiness_impact?: boolean;
  requires_dual_sign?: boolean;
  estimated_minutes?: number | null;
  auto_complete_after_hours?: number | null;
  is_active?: boolean;
};

export const OPERATION_CADENCE_LABELS: Record<OceCadenceType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  on_demand: "On demand",
  event_driven: "Event driven",
};

export function isOperationTemplateCategory(value: string): value is keyof typeof OPERATION_CATEGORY_LABELS {
  return value in OPERATION_CATEGORY_LABELS;
}

export function isOceCadenceType(value: string): value is OceCadenceType {
  return (OCE_CADENCE_TYPES as readonly string[]).includes(value);
}

export function isOcePriorityLevel(value: string): value is OcePriorityLevel {
  return (OCE_PRIORITY_LEVELS as readonly string[]).includes(value);
}

export function isOceShiftScope(value: string): value is OceShiftScope {
  return (OCE_SHIFT_SCOPES as readonly string[]).includes(value);
}

export function isOceAssigneeRole(value: string): value is OceTemplateAssigneeRole {
  return (OCE_TEMPLATE_ASSIGNEE_ROLES as readonly string[]).includes(value);
}

export function normalizeEscalationLadder(value: unknown): OperationEscalationStep[] {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const candidate = step as Partial<OperationEscalationStep>;
      if (typeof candidate.role !== "string" || candidate.role.trim().length === 0) return null;
      if (typeof candidate.channel !== "string" || candidate.channel.trim().length === 0) return null;

      const minutes = Number(candidate.sla_minutes);
      if (!Number.isFinite(minutes) || minutes < 0) return null;

      return {
        role: candidate.role.trim(),
        channel: candidate.channel.trim(),
        sla_minutes: Math.round(minutes),
        enabled: candidate.enabled !== false,
      } satisfies OperationEscalationStep;
    })
    .filter((step): step is OperationEscalationStep => Boolean(step));
}

export function normalizeOperationTemplateMutationBody(body: OperationTemplateMutationPayload) {
  const name = body.name?.trim();
  const description = body.description?.trim();
  const category = body.category?.trim();
  const cadence = body.cadence_type?.trim();

  if (!name || !description || !category || !cadence) {
    return { error: "name, description, category, and cadence_type are required" } as const;
  }
  if (!isOperationTemplateCategory(category)) {
    return { error: "Invalid category" } as const;
  }
  if (!isOceCadenceType(cadence)) {
    return { error: "Invalid cadence_type" } as const;
  }

  const shiftScope = body.shift_scope?.trim();
  if (shiftScope && !isOceShiftScope(shiftScope)) {
    return { error: "Invalid shift_scope" } as const;
  }

  const assigneeRole = body.assignee_role?.trim();
  if (assigneeRole && !isOceAssigneeRole(assigneeRole)) {
    return { error: "Invalid assignee_role" } as const;
  }

  const fallbackRole = body.required_role_fallback?.trim();
  if (fallbackRole && !isOceAssigneeRole(fallbackRole)) {
    return { error: "Invalid required_role_fallback" } as const;
  }

  const priority = body.priority?.trim() ?? "normal";
  if (!isOcePriorityLevel(priority)) {
    return { error: "Invalid priority" } as const;
  }

  const dayOfWeek = normalizeInteger(body.day_of_week);
  const dayOfMonth = normalizeInteger(body.day_of_month);
  const monthOfYear = normalizeInteger(body.month_of_year);
  const estimatedMinutes = normalizeInteger(body.estimated_minutes);
  const autoCompleteAfterHours = normalizeInteger(body.auto_complete_after_hours);

  if (dayOfWeek !== null && (dayOfWeek < 1 || dayOfWeek > 7)) {
    return { error: "day_of_week must be between 1 and 7" } as const;
  }
  if (dayOfMonth !== null && (dayOfMonth < 1 || dayOfMonth > 31)) {
    return { error: "day_of_month must be between 1 and 31" } as const;
  }
  if (monthOfYear !== null && (monthOfYear < 1 || monthOfYear > 12)) {
    return { error: "month_of_year must be between 1 and 12" } as const;
  }
  if (estimatedMinutes !== null && estimatedMinutes < 0) {
    return { error: "estimated_minutes must be zero or greater" } as const;
  }
  if (autoCompleteAfterHours !== null && autoCompleteAfterHours < 0) {
    return { error: "auto_complete_after_hours must be zero or greater" } as const;
  }

  return {
    facility_id: body.facility_id?.trim() || null,
    name,
    description,
    category,
    cadence_type: cadence,
    shift_scope: shiftScope ?? null,
    day_of_week: dayOfWeek,
    day_of_month: dayOfMonth,
    month_of_year: monthOfYear,
    assignee_role: assigneeRole ?? null,
    required_role_fallback: fallbackRole ?? null,
    escalation_ladder: normalizeEscalationLadder(body.escalation_ladder),
    asset_ref: body.asset_ref?.trim() || null,
    vendor_booking_ref: body.vendor_booking_ref?.trim() || null,
    linked_document_id: body.linked_document_id?.trim() || null,
    priority,
    license_threatening: Boolean(body.license_threatening),
    compliance_requirement: body.compliance_requirement?.trim() || null,
    survey_readiness_impact: Boolean(body.survey_readiness_impact),
    requires_dual_sign: Boolean(body.requires_dual_sign),
    estimated_minutes: estimatedMinutes,
    auto_complete_after_hours: autoCompleteAfterHours,
    is_active: body.is_active ?? true,
  } as const;
}

function safeParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    return [];
  }
}

function normalizeInteger(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return null;
  }
  return Math.round(Number(value));
}
