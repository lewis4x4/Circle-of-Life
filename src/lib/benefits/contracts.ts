import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";

export const BENEFITS_PROGRAMS = ["smmc_ltc", "oss", "other"] as const;
export const BENEFITS_STATUSES = ["open", "waiting", "closed"] as const;
export const BENEFITS_STAGES = ["screening", "referral", "assessment", "application", "funding", "renewal"] as const;
export const REQUIREMENT_STATUSES = ["missing", "requested", "received", "accepted", "rejected", "not_applicable"] as const;
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
]);
export const benefitsAccessSchema = z.object({ facility_id: uuid, user_id: uuid, can_write: z.boolean(), can_review: z.boolean(), expires_at: z.string().datetime({ offset: true }), revoked: z.boolean().default(false), reason: z.string().trim().min(1).max(2000) }).strict();
export type BenefitsCommand = z.infer<typeof benefitsCommandSchema>;
export type BenefitsScreening = z.infer<typeof benefitsScreeningSchema>;
export type BenefitsFunding = z.infer<typeof benefitsFundingSchema>;
export type BenefitsProgram = typeof BENEFITS_PROGRAMS[number];
export type BenefitsStatus = typeof BENEFITS_STATUSES[number];
export interface BenefitsPermissions { can_write: boolean; can_review: boolean; can_manage_access: boolean }
export interface BenefitsCase { id: string; organization_id: string; facility_id: string; resident_id: string; admission_case_id: string | null; program: BenefitsProgram; status: BenefitsStatus; revision: number; next_action: string | null; assigned_to: string | null; due_date: string | null; closure_reason: string | null; screening: BenefitsScreening; funding: BenefitsFunding; created_at: string; updated_at: string; created_by: string; resident_name: string; facility_name: string; assignee_name: string | null }
export interface BenefitsRequirement extends z.infer<typeof benefitsRequirementSchema> { id: string; case_id: string; reviewed_by: string | null; reviewed_at: string | null; updated_at: string }
export interface BenefitsDocument { id: string; case_id: string; filename: string; mime_type: string; size_bytes: number; sha256: string; storage_path: string; status: "reserved" | "ready"; document_type: string; template_version: string | null; created_at: string; created_by: string }
export interface BenefitsEvent extends z.infer<typeof benefitsEventSchema> { id: string; case_id: string; created_at: string; created_by: string }
export interface BenefitsSubmission extends z.infer<typeof benefitsSubmissionSchema> { id: string; case_id: string; manifest: Array<{ id: string; sha256: string; filename: string }>; created_at: string; created_by: string }
export interface BenefitsReceipt extends z.infer<typeof benefitsReceiptSchema> { id: string; case_id: string; created_at: string; created_by: string }
export interface BenefitsAudit { id: string; case_id: string; action: string; payload: Record<string, unknown>; created_at: string; created_by: string; revision: number }
export interface BenefitsDetail { case: BenefitsCase; permissions: BenefitsPermissions; requirements: BenefitsRequirement[]; documents: BenefitsDocument[]; events: BenefitsEvent[]; submissions: BenefitsSubmission[]; receipts: BenefitsReceipt[]; history: BenefitsAudit[]; history_has_more: boolean }
export interface BenefitsCaseList { cases: BenefitsCase[]; next_cursor: string | null }
export interface BenefitsOptions { facilities: Array<{id: string; name: string}>; residents: Array<{id: string; name: string; facility_id: string}>; assignees: Array<{id: string; name: string; facility_id: string}>; can_manage_access: boolean }
export interface BenefitsAccessGrant { id: string; facility_id: string; user_id: string; can_write: boolean; can_review: boolean; expires_at: string; revoked_at: string | null; reason: string; granted_by: string; updated_at: string; user_name: string; facility_name: string }
