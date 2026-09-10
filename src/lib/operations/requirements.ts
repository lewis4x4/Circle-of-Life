import { z } from "zod";

import { validateScheduleRule } from "@/lib/operations/schedule-evaluator";

/**
 * COL-135 requirement versions and facility configurations. The database owns
 * validation and authority; these helpers only shape requests and map database
 * outcomes to bounded HTTP responses without echoing internal detail.
 * COL-137 adds the schedule rule shape: the evaluator validates it here and
 * the database validates the same shape before a draft or publication.
 */

export const REQUIREMENT_CENTRAL_ROLES = ["owner", "org_admin"] as const;
export const REQUIREMENT_FACILITY_ROLES = ["owner", "org_admin", "facility_admin"] as const;
export const REQUIREMENT_VIEW_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "dietary",
  "maintenance_role",
  "housekeeper",
] as const;

const uuid = z.string().uuid();
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const nonEmpty = z.string().trim().min(1).max(8000);

export const requirementInputRuleSchema = z
  .object({
    key: identifier,
    label: nonEmpty,
    type: z.enum(["number", "text", "boolean", "choice", "datetime"]),
    required: z.boolean(),
    unit: z.string().trim().min(1).max(64).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    choices: z.array(nonEmpty).min(1).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if ((rule.min !== undefined || rule.max !== undefined) && rule.type !== "number") {
      ctx.addIssue({ code: "custom", message: "min and max apply to number inputs only" });
    }
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
      ctx.addIssue({ code: "custom", message: "min must not exceed max" });
    }
    if (rule.type === "choice" && !rule.choices) ctx.addIssue({ code: "custom", message: "choice inputs need choices" });
    if (rule.type !== "choice" && rule.choices) ctx.addIssue({ code: "custom", message: "choices apply to choice inputs only" });
  });

export const requirementEvidenceRuleSchema = z
  .object({
    kind: z.enum(["document", "photo", "signature", "linked_record", "reading"]),
    label: nonEmpty,
    min_count: z.number().int().finite().min(1),
    when: z.enum(["always", "on_failure", "on_success"]),
  })
  .strict();

const roleList = z.array(z.string().trim().min(1)).max(32).superRefine((roles, ctx) => {
  if (new Set(roles).size !== roles.length) ctx.addIssue({ code: "custom", message: "roles must be unique" });
});
/** Input keys and evidence labels are identities; the database rejects duplicates, so say so before the command. */
const inputRules = z.array(requirementInputRuleSchema).max(64).superRefine((rules, ctx) => {
  if (new Set(rules.map((rule) => rule.key)).size !== rules.length) ctx.addIssue({ code: "custom", message: "input keys must be unique" });
});
const evidenceRules = z.array(requirementEvidenceRuleSchema).max(64).superRefine((rules, ctx) => {
  if (new Set(rules.map((rule) => rule.label)).size !== rules.length) ctx.addIssue({ code: "custom", message: "evidence labels must be unique" });
});

export const requirementDraftPayloadSchema = z
  .object({
    title: z.string().trim().max(500).optional(),
    wording: z.string().trim().max(8000).optional(),
    procedure: z.string().trim().max(20000).optional(),
    source_authority: z.record(z.string(), z.unknown()).optional(),
    subject_kind: z.enum(["facility", "resident", "employee", "asset"]).optional(),
    allowed_recorder_roles: roleList.optional(),
    allowed_reviewer_roles: roleList.optional(),
    review_required: z.boolean().optional(),
    required_inputs: inputRules.optional(),
    required_evidence: evidenceRules.optional(),
  })
  .strict();

export const facilityRequirementDraftPayloadSchema = z
  .object({
    requirement_version_id: uuid.nullable().optional(),
    applicability: z.enum(["applicable", "not_applicable", "needs_confirmation"]).optional(),
    applicability_reason: z.string().trim().max(4000).nullable().optional(),
    override_source: z.enum(["central", "admin_log", "interview", "facility_policy", "regulator", "other"]).optional(),
    local_procedure: z.string().trim().max(20000).nullable().optional(),
    local_allowed_recorder_roles: roleList.nullable().optional(),
    local_required_inputs: inputRules.nullable().optional(),
    local_required_evidence: evidenceRules.nullable().optional(),
    owner_role: z.string().trim().min(1).nullable().optional(),
    owner_user_id: uuid.nullable().optional(),
    backup_role: z.string().trim().min(1).nullable().optional(),
    backup_user_id: uuid.nullable().optional(),
    schedule_status: z.enum(["needs_confirmation", "confirmed"]).optional(),
    schedule_rule: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    // A confirmed schedule without a rule is a contradiction the database also rejects; say so first.
    if (payload.schedule_status === "confirmed" && payload.schedule_rule === null) {
      ctx.addIssue({ code: "custom", message: "a confirmed schedule requires a rule" });
    }
    // The evaluator defines the rule shape (COL-137); the database validates the same shape.
    if (payload.schedule_rule) {
      const validated = validateScheduleRule(payload.schedule_rule);
      if (!validated.ok) {
        ctx.addIssue({ code: "custom", path: ["schedule_rule"], message: validated.problems[0] ?? "schedule rule is invalid" });
      }
    }
  });

/** The first schedule-rule problem in a failed parse, for a bounded client error. */
export function scheduleRuleProblem(error: z.ZodError): string | null {
  const issue = error.issues.find((candidate) => candidate.path.includes("schedule_rule"));
  return issue ? issue.message : null;
}

export const saveRequirementDraftBodySchema = z
  .object({ activity_id: uuid, payload: requirementDraftPayloadSchema })
  .strict();
export const saveFacilityRequirementDraftBodySchema = z
  .object({ activity_id: uuid, facility_id: uuid, payload: facilityRequirementDraftPayloadSchema })
  .strict();
export const publicationBodySchema = z
  .object({ effective_from: z.string().datetime({ offset: true }) })
  .strict();

export type RequirementDraftPayload = z.infer<typeof requirementDraftPayloadSchema>;
export type FacilityRequirementDraftPayload = z.infer<typeof facilityRequirementDraftPayloadSchema>;

/** Database messages that are safe and useful to show the operator verbatim. */
const TRUSTED_FRAGMENTS = [
  "is not publishable",
  "contains an invalid",
  "is not editable",
  "payload must be an object",
  "must match the activity subject",
  "must be a subset of the central roles",
  "must keep every central",
  "require a published central version",
  "must reference a published central version",
  "owner unavailable",
  "backup unavailable",
  "site unavailable",
  "requires a rule",
  "schedule rule ",
  "schedule confirmation requires",
];
/** Database rejections of the request itself (not of the current state) are client errors. */
const CLIENT_ERROR_FRAGMENTS = ["contains an invalid", "is not editable", "payload must be an object"];

export type RequirementRpcError = { code?: string; message?: string } | null | undefined;

export type RequirementPublicationRpc =
  | "preview_operation_requirement_review"
  | "publish_operation_requirement_review"
  | "preview_operation_facility_requirement_review"
  | "publish_operation_facility_requirement_review";

/**
 * Authority denials hide existence; validation and immutability outcomes are
 * reported with their bounded message; anything else is a generic failure.
 */
export function mapRequirementRpcError(error: NonNullable<RequirementRpcError>): { status: number; error: string } {
  const message = error.message ?? "";
  if (error.code === "42501") return { status: 403, error: "Requirement unavailable" };
  const trusted = TRUSTED_FRAGMENTS.some((fragment) => message.includes(fragment));
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") {
    if (trusted && CLIENT_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment))) return { status: 400, error: message };
    return { status: 409, error: trusted ? message : "Requirement request could not be completed. Review the current version and retry." };
  }
  if (error.code === "22P02" || error.code === "22007" || error.code === "23503") {
    return { status: 400, error: "Requirement request contains an invalid reference or value" };
  }
  return { status: 500, error: "Requirement request could not be completed" };
}

export function isRequirementRecord(value: unknown): value is Record<string, unknown> & { id: string; status: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && typeof (value as { status?: unknown }).status === "string";
}

export function isPublicationPreview(value: unknown): value is Record<string, unknown> & { publishable: boolean; problems: string[] } {
  return !!value && typeof value === "object" && typeof (value as { publishable?: unknown }).publishable === "boolean" && Array.isArray((value as { problems?: unknown }).problems);
}
