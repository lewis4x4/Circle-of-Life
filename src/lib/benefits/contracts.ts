import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";

export const BENEFITS_PROGRAMS = ["smmc_ltc", "oss", "other"] as const;
export const BENEFITS_STATUSES = ["open", "waiting", "closed"] as const;
export const BENEFITS_STAGES = ["screening", "referral", "assessment", "application", "funding", "renewal"] as const;
export const REQUIREMENT_STATUSES = ["missing", "requested", "received", "accepted", "rejected", "not_applicable", "expired"] as const;
export const BENEFITS_AGENCIES = ["elder_options", "cares", "dcf", "plan", "other"] as const;
export const BENEFITS_EVENT_TYPES = ["screening", "waitlist", "assessment", "application", "eligibility", "enrollment", "authorization", "correspondence", "denial", "appeal", "renewal", "notice_review", "note"] as const;
export const BENEFITS_BUCKET = "benefits-documents";
export const BENEFITS_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const BENEFITS_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const uuid = databaseUuidSchema;
const text = z.string().trim().max(4000);
const date = z.iso.date();
const cents = z.number().int().min(0).max(999999999999);
const knowledge = z.enum(["yes", "no", "unknown"]);
export const benefitsScreeningSchema = z.object({
  income_cents: cents.nullable().optional(), assets_cents: cents.nullable().optional(),
  income_basis: z.enum(["gross", "countable", "unknown"]).optional(),
  property: knowledge.optional(), life_insurance: knowledge.optional(), burial: knowledge.optional(),
  power_of_attorney: knowledge.optional(), married: knowledge.optional(), notes: text.optional(), rule_reference: text.optional(),
}).strict();
export const benefitsFundingSchema = z.object({
  plan: z.string().max(200).optional(), reference: z.string().max(200).optional(),
  coverage_start: date.nullable().optional(), coverage_end: date.nullable().optional(),
  renewal_date: date.nullable().optional(), resident_contribution_cents: cents.nullable().optional(),
  expected_benefit_cents: cents.nullable().optional(), status: z.enum(["unverified", "reviewed"]).optional(),
  evidence_event_ids: z.array(uuid).max(30).optional(), notes: text.optional(),
}).strict();
export const createBenefitsCaseSchema = z.object({ resident_id: uuid, admission_case_id: uuid.nullable().optional(), program: z.enum(BENEFITS_PROGRAMS), request_id: uuid }).strict();
export const updateBenefitsCaseSchema = z.object({
  status: z.enum(BENEFITS_STATUSES).optional(), next_action: text.nullable().optional(),
  assigned_to: uuid.nullable().optional(), due_date: date.nullable().optional(), closure_reason: text.nullable().optional(),
  screening: benefitsScreeningSchema.optional(), funding: benefitsFundingSchema.optional(),
}).strict();
export const benefitsRequirementSchema = z.object({
  id: uuid.optional(), title: z.string().trim().min(1).max(200), stage: z.enum(BENEFITS_STAGES), status: z.enum(REQUIREMENT_STATUSES),
  assigned_to: uuid.nullable().optional(), due_date: date.nullable().optional(), notes: text.nullable().optional(),
  document_id: uuid.nullable().optional(), review_reason: text.nullable().optional(),
  signature_status: z.enum(["not_required", "pending", "verified"]).default("not_required"),
  signed_on: date.nullable().optional(),
}).strict();
export const benefitsEventSchema = z.object({
  agency: z.enum(BENEFITS_AGENCIES), event_type: z.enum(BENEFITS_EVENT_TYPES), outcome: z.string().trim().min(1).max(200),
  occurred_on: date, notes: text.optional(), source_reference: text.optional(), document_id: uuid.nullable().optional(),
  due_date: date.nullable().optional(), formal_decision: z.boolean().default(false),
}).strict();
export const benefitsSubmissionSchema = z.object({
  stage: z.enum(BENEFITS_STAGES), destination: z.string().trim().min(1).max(300),
  method: z.enum(["fax", "portal", "mail", "secure_email", "in_person"]),
  sent_at: z.string().datetime({ offset: true }), external_reference: text.optional(),
  document_ids: z.array(uuid).min(1).max(50), notes: text.optional(),
}).strict();
export const benefitsReceiptSchema = z.object({ submission_id: uuid, received_at: z.string().datetime({ offset: true }), source_reference: text.optional(), document_id: uuid.nullable().optional(), notes: text.optional() }).strict();
const commandBase = { request_id: uuid, expected_revision: z.number().int().min(1) };
export const benefitsCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...commandBase, action: z.literal("update_case"), payload: updateBenefitsCaseSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("upsert_requirement"), payload: benefitsRequirementSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("record_event"), payload: benefitsEventSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("record_submission"), payload: benefitsSubmissionSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("record_receipt"), payload: benefitsReceiptSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("void_document"), payload: z.object({ document_id: uuid, reason: z.string().trim().min(1).max(2000) }).strict() }).strict(),
]);
export const BENEFITS_RULE_KEYS = ["checklist.smmc_ltc", "checklist.oss", "checklist.other", "screening.standard_individual", "family_collection.max_days", "renewal.warning_days", "screening.admission_gate", "screening.recheck_days", "runway.lead_days"] as const;
export type BenefitsRuleKey = typeof BENEFITS_RULE_KEYS[number];
export const checklistRuleSchema = z.array(z.object({ title: z.string().trim().min(1).max(200), stage: z.enum(BENEFITS_STAGES), signature_status: z.enum(["not_required", "pending"]).default("not_required") }).strict()).max(60);
export const screeningStandardSchema = z.object({ income_cents: z.number().int().min(1).max(99_999_999), assets_cents: z.number().int().min(1).max(9_999_999_999), label: z.string().trim().min(1).max(200), source: z.string().max(500).optional() }).strict();
export const dayWindowSchema = z.number().int().min(0).max(365);
/** The six New Admits Medicaid Pending Criteria questions, in printed order (A–F). */
export const SCREENING_QUESTIONS = ["q_property_non_primary", "q_income_over_limit", "q_life_insurance", "q_burial_contract", "q_assets", "q_power_of_attorney"] as const;
export type ScreeningQuestion = typeof SCREENING_QUESTIONS[number];
export const admissionGateSchema = z.object({
  disqualify: z.array(z.enum(SCREENING_QUESTIONS)).min(1).max(6).refine((list) => new Set(list).size === list.length, "Each question once"),
  income_limit_cents: z.number().int().min(1).max(99_999_999),
  assets_limit_cents: z.number().int().min(1).max(9_999_999_999),
  source: z.string().max(500).optional(),
}).strict();
export type AdmissionGate = z.infer<typeof admissionGateSchema>;
export const benefitsRuleSetSchema = z.discriminatedUnion("rule_key", [
  z.object({ rule_key: z.literal("checklist.smmc_ltc"), value: checklistRuleSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("checklist.oss"), value: checklistRuleSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("checklist.other"), value: checklistRuleSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("screening.standard_individual"), value: screeningStandardSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("family_collection.max_days"), value: dayWindowSchema.min(1), effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("renewal.warning_days"), value: dayWindowSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("screening.admission_gate"), value: admissionGateSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("screening.recheck_days"), value: dayWindowSchema.min(1), effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ rule_key: z.literal("runway.lead_days"), value: dayWindowSchema, effective_from: date, reason: z.string().trim().min(1).max(2000) }).strict(),
]);
export const SCREENING_COVERAGE = ["unknown", "none", "private_pay", "medicaid_mma", "application_pending", "smmc_ltc_enrolled"] as const;
export const SCREENING_RESULTS = ["candidate", "not_qualified_now", "needs_answers", "already_enrolled"] as const;
export const SCREENING_RESPONDENTS = ["resident", "poa", "family", "staff_records"] as const;
export type ScreeningCoverage = typeof SCREENING_COVERAGE[number];
export type ScreeningResult = typeof SCREENING_RESULTS[number];
export const admissionScreeningSchema = z.object({
  resident_id: uuid, admission_case_id: uuid.nullable().optional(),
  source: z.enum(["admission", "recheck", "manual"]), coverage: z.enum(SCREENING_COVERAGE), coverage_plan: z.string().trim().max(200).nullable().optional(),
  q_property_non_primary: knowledge, q_income_over_limit: knowledge, q_life_insurance: knowledge, q_burial_contract: knowledge, q_assets: knowledge, q_power_of_attorney: knowledge,
  monthly_income_cents: z.number().int().min(0).max(99_999_999).nullable().optional(), assets_cents: z.number().int().min(0).max(99_999_999_999).nullable().optional(),
  private_pay_months: z.number().int().min(0).max(240).nullable().optional(),
  answered_by_kind: z.enum(SCREENING_RESPONDENTS).nullable().optional(), answered_at: z.string().datetime({ offset: true }).optional(),
  notes: text.nullable().optional(),
}).strict();
export const recordAdmissionScreeningSchema = z.object({ request_id: uuid, screening: admissionScreeningSchema }).strict();
export const overrideAdmissionScreeningSchema = z.object({ request_id: uuid, result: z.enum(["candidate", "not_qualified_now", "needs_answers"]), reason: z.string().trim().min(1).max(2000) }).strict();
export type AdmissionScreeningInput = z.infer<typeof admissionScreeningSchema>;
export interface AdmissionScreeningOverride { id: string; screening_id: string; result: Exclude<ScreeningResult, "already_enrolled">; reason: string; case_id: string | null; created_by: string; created_by_name: string | null; created_at: string }
export interface AdmissionScreeningRow extends Omit<AdmissionScreeningInput, "resident_id"> { id: string; answered_at: string; runway_date: string | null; result: ScreeningResult; reasons: string[]; created_at: string; recorded_by_name: string | null; override: AdmissionScreeningOverride | null }
export interface AdmissionRecheck { id: string; due_on: string; status: "open" | "done" | "closed"; screening_id: string }
export interface AdmissionScreeningList { resident_id: string; facility_id: string; permissions: { can_write: boolean; can_review: boolean }; gate: AdmissionGate; active_case_id: string | null; open_recheck: AdmissionRecheck | null; screenings: AdmissionScreeningRow[] }
export const completeRecheckSchema = z.object({ request_id: uuid, outcome: z.enum(["no_change", "resident_left"]), note: z.string().trim().max(2000).nullable().optional() }).strict();
export interface RecheckRow {
  id: string; facility_id: string; facility_name: string; resident_id: string; resident_name: string; due_on: string; overdue: boolean; can_write: boolean;
  last_answered_at: string; last_result: ScreeningResult; last_reasons: string[];
  q_property_non_primary: "yes" | "no" | "unknown"; q_income_over_limit: "yes" | "no" | "unknown"; q_assets: "yes" | "no" | "unknown";
}
export interface RecheckList { as_of: string; rechecks: RecheckRow[] }
export const startSweepSchema = z.object({ request_id: uuid, facility_id: uuid, note: z.string().trim().max(2000).nullable().optional() }).strict();
export interface SweepFacility { facility_id: string; facility_name: string; started_at: string | null; started_by_name: string | null; can_write: boolean; total: number; answered: number; remaining: Array<{ resident_id: string; resident_name: string; status: string }> | null }
export interface SweepStatus { can_start: boolean; facilities: SweepFacility[] }
export const PROMPT_KINDS = ["runway", "late_payments"] as const;
export type PromptKind = typeof PROMPT_KINDS[number];
export const startPromptCaseSchema = z.object({ request_id: uuid, resident_id: uuid, kind: z.enum(PROMPT_KINDS) }).strict();
export const dismissPromptSchema = z.object({ request_id: uuid, resident_id: uuid, kind: z.enum(PROMPT_KINDS), days: z.number().int().min(1).max(180), reason: z.string().trim().min(1).max(2000) }).strict();
export interface RunwayPrompt { resident_id: string; resident_name: string; facility_id: string; facility_name: string; runway_date: string; days_left: number; last_result: ScreeningResult; can_write: boolean }
export interface LatePaymentPrompt { resident_id: string; resident_name: string; facility_id: string; facility_name: string; oldest_due: string; owed_cents: number; can_write: boolean }
export interface MedicaidPrompts { as_of: string; late_signal: Array<{ facility_id: string; facility_name: string; live: boolean }>; runway: RunwayPrompt[]; late_payments: LatePaymentPrompt[] }
export interface AdmissionScreeningReply { screening_id: string; result: ScreeningResult; reasons: string[]; case_id: string | null; recheck_id: string | null; recheck_due_on: string | null }
export interface BenefitsRuleRow { id: string; organization_id: string; rule_key: BenefitsRuleKey; value: unknown; effective_from: string; reason: string; created_by: string | null; created_at: string }
export interface BenefitsRuleEntry { rule_key: BenefitsRuleKey; current: BenefitsRuleRow | null; value: unknown; scheduled: BenefitsRuleRow[]; history_count: number }
export interface BenefitsRulesList { can_manage: boolean; as_of: string; rules: BenefitsRuleEntry[] }
export type ScreeningStandard = z.infer<typeof screeningStandardSchema> & { effective_from: string | null };
export const benefitsAccessSchema = z.object({ facility_id: uuid, user_id: uuid, can_write: z.boolean(), can_review: z.boolean(), expires_at: z.string().datetime({ offset: true }), revoked: z.boolean().default(false), reason: z.string().trim().min(1).max(2000) }).strict();
export type BenefitsCommand = z.infer<typeof benefitsCommandSchema>;
export type BenefitsScreening = z.infer<typeof benefitsScreeningSchema>;
export type BenefitsFunding = z.infer<typeof benefitsFundingSchema>;
export type BenefitsProgram = typeof BENEFITS_PROGRAMS[number];
export type BenefitsStatus = typeof BENEFITS_STATUSES[number];
export interface BenefitsPermissions { can_write: boolean; can_review: boolean; can_manage_access: boolean }
export interface BenefitsCase { id: string; organization_id: string; facility_id: string; resident_id: string; admission_case_id: string | null; program: BenefitsProgram; status: BenefitsStatus; revision: number; next_action: string | null; assigned_to: string | null; due_date: string | null; closure_reason: string | null; screening: BenefitsScreening; funding: BenefitsFunding; created_at: string; updated_at: string; created_by: string; resident_name: string; facility_name: string; assignee_name: string | null; resident_status?: string | null; resident_facility_id?: string | null; resident_facility_name?: string | null; needs_rebind?: boolean; renewal_date?: string | null; assignee_active?: boolean | null }
export interface BenefitsRequirement extends z.infer<typeof benefitsRequirementSchema> { id: string; case_id: string; reviewed_by: string | null; reviewed_at: string | null; updated_at: string; assignee_name?: string | null }
export interface BenefitsDocument { id: string; case_id: string; filename: string; mime_type: string; size_bytes: number; sha256: string; storage_path: string; status: "reserved" | "ready"; document_type: string; template_version: string | null; created_at: string; created_by: string; voided_at?: string | null; voided_by?: string | null; void_reason?: string | null }
export interface BenefitsEvent extends z.infer<typeof benefitsEventSchema> { id: string; case_id: string; created_at: string; created_by: string }
export interface BenefitsSubmission extends z.infer<typeof benefitsSubmissionSchema> { id: string; case_id: string; manifest: Array<{ id: string; sha256: string; filename: string }>; created_at: string; created_by: string }
export interface BenefitsReceipt extends z.infer<typeof benefitsReceiptSchema> { id: string; case_id: string; created_at: string; created_by: string }
export interface BenefitsAudit { id: string; case_id: string; action: string; payload: Record<string, unknown>; created_at: string; created_by: string; revision: number }
export interface BenefitsDetail { case: BenefitsCase; permissions: BenefitsPermissions; requirements: BenefitsRequirement[]; documents: BenefitsDocument[]; events: BenefitsEvent[]; submissions: BenefitsSubmission[]; receipts: BenefitsReceipt[]; history: BenefitsAudit[]; history_has_more: boolean }
export interface BenefitsCaseList { cases: BenefitsCase[]; next_cursor: string | null }
export interface UncasedMedicaidResident { id: string; name: string; facility_id: string; payer_type: string; suggested_program: BenefitsProgram; medicaid_authorization_end: string | null }
export interface BenefitsOptions { facilities: Array<{id: string; name: string}>; residents: Array<{id: string; name: string; facility_id: string}>; assignees: Array<{id: string; name: string; facility_id: string}>; can_manage_access: boolean; uncased_medicaid_residents?: UncasedMedicaidResident[]; actor_id?: string }
export interface BenefitsAccessGrant { id: string; facility_id: string; user_id: string; can_write: boolean; can_review: boolean; expires_at: string; revoked_at: string | null; reason: string; granted_by: string; updated_at: string; user_name: string; facility_name: string }
