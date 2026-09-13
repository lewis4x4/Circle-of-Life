import { z } from "zod";
import { databaseUuidSchema as uuid } from "./database-uuid";
export const PROVIDER_DOCUMENT_BUCKET = "resident-documents" as const;
export const providerDocumentTypeSchema = z.enum(["form_1823", "hospice_plan", "community_support_plan", "support_plan", "provider_report", "other"]);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const text = z.string().trim().min(1).max(1000);
const timestamp = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();
const exactlyOne = (a: unknown, b: unknown) => Number(a != null) + Number(b != null) === 1;
export const providerReportCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), task_id: uuid, request_key: key, contact_id: uuid, document_type: providerDocumentTypeSchema, expected_version: text, service_at: timestamp.nullable().optional(), service_on: dateOnly.nullable().optional(), service_provenance: text }).strict().refine(v => exactlyOne(v.service_at,v.service_on), "Provide the actual service date or timestamp"),
  z.object({ action: z.literal("set_due"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid, due_at: timestamp.nullable().optional(), due_on: dateOnly.nullable().optional(), approval_reference: text, approver_label: text, approved_at: timestamp.nullable().optional(), approved_on: dateOnly.nullable().optional(), effective_date: z.iso.date(), source_version_id: uuid }).strict().refine(v => exactlyOne(v.due_at,v.due_on) && exactlyOne(v.approved_at,v.approved_on), "Retain actual due and approval precision"),
  z.object({ action: z.literal("attach_receipt"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid, version_id: uuid, received_at: timestamp.nullable().optional(), received_on: dateOnly.nullable().optional(), receipt_provenance: text }).strict().refine(v => exactlyOne(v.received_at,v.received_on), "Provide actual receipt date or timestamp"),
  z.object({ action: z.literal("review"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid, version_id: uuid, result: z.enum(["reviewed", "follow_up_needed"]), findings: text }).strict(),
  z.object({ action: z.literal("signature_observation"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid, version_id: uuid, signer_role: z.enum(["caseworker", "resident", "administrator", "other"]), signer_label: text, page: z.number().int().min(1).max(10000), source_provenance: text, signed_at: timestamp.nullable().optional(), signed_on: dateOnly.nullable().optional(), corrects_event_id: uuid.optional() }).strict().refine(v => !(v.signed_at && v.signed_on), "Keep one signature date precision"),
  z.object({ action: z.literal("create_chase"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid }).strict(),
  z.object({ action: z.literal("link_chase"), task_id: uuid, request_key: key, expectation_id: uuid, expected_revision: uuid, issue_id: uuid }).strict(),
]);
export const providerDocumentPrepareSchema = z.object({ task_id: uuid, request_key: key, document_type: providerDocumentTypeSchema, title: z.string().trim().min(1).max(200), declared_mime: z.enum(["application/pdf", "image/jpeg", "image/png"]), declared_size_bytes: z.number().int().min(1).max(20971520), declared_sha256: z.string().regex(/^[a-f0-9]{64}$/), supersedes_version_id: uuid.optional() }).strict();
export const providerDocumentFinalizeSchema = z.object({ task_id: uuid, request_key: key, expected_revision: uuid }).strict();
export const providerDocumentVersionSchema = z.object({
  id: uuid, document_id: uuid, native_document_id: uuid.nullable(), task_id: uuid, resident_id: uuid, facility_id: uuid,
  document_type: providerDocumentTypeSchema, title: z.string(), state: z.enum(["prepared", "finalized"]), revision: uuid,
  declared_mime: z.string(), declared_size_bytes: z.number(), declared_sha256: z.string(),
  bucket: z.literal(PROVIDER_DOCUMENT_BUCKET), object_path: z.string(), supersedes_version_id: uuid.nullable(),
  prepared_at: z.string(), finalized_at: z.string().nullable(), checksum_verified: z.boolean(), native_current: z.boolean().optional().default(false), page_count: z.number().int().nullable(),
}).strict();
export type ProviderDocumentVersion = z.infer<typeof providerDocumentVersionSchema>;
export const providerReportEventSchema = z.object({ id: uuid, task_id: uuid.optional(), kind: z.string(), actor_id: uuid, recorded_at: z.string(), details: z.record(z.string(), z.unknown()) }).strict();
export const providerReportExpectationSchema = z.object({
  id: uuid, origin_task_id: uuid.optional(), revision: uuid, document_type: providerDocumentTypeSchema, expected_version: z.string(), contact_id: uuid, contact_label: z.string(), contact_current: z.boolean(),
  service_at: z.string().nullable(), service_on: dateOnly.nullable().optional().default(null), service_provenance: z.string(), service_confirmation: z.literal("operator_attested"),
  due_at: z.string().nullable(), due_on: dateOnly.nullable().optional().default(null), due_state: z.enum(["unknown", "documented_approval", "documented_approval_pending_effective"]), due_provenance: z.record(z.string(), z.unknown()).nullable(), overdue: z.boolean(),
  current_version_id: uuid.nullable(), received_at: z.string().nullable(), received_on: dateOnly.nullable().optional().default(null), receipt_provenance: z.string().nullable(),
  review_state: z.enum(["not_reviewed", "reviewed", "follow_up_needed"]), last_review: z.object({task_id:uuid,recorded_at:z.string(),reviewer_id:uuid,result:z.enum(["reviewed","follow_up_needed"])}).nullable().optional().default(null), required_signers: z.literal("unknown"),
  chase_issue_id: uuid.nullable(), owner_user_id: uuid.nullable(), owner_role: z.string().nullable(), follow_up_at: z.string().nullable(), owner_label: z.string().nullable(),
  events: z.array(providerReportEventSchema).max(100), events_complete: z.boolean(),
}).strict();
export const providerReportsReplySchema = z.object({
  task_id: uuid, eligible: z.boolean(), availability: z.enum(["available", "unavailable"]), reason: z.string(), resident_id: uuid.nullable(),
  can_manage: z.boolean(), can_intake: z.boolean(), chase_candidates: z.array(z.object({id:uuid,label:z.string(),status:z.string(),owner_label:z.string().nullable()}).strict()).max(100), contacts: z.array(z.object({ id: uuid, label: z.string(), type: z.string() }).strict()).max(100),
  expectations: z.array(providerReportExpectationSchema).max(100), versions: z.array(providerDocumentVersionSchema).max(100), complete: z.boolean(),
}).strict();
export type ProviderReportsReply = z.infer<typeof providerReportsReplySchema>;
/** Native contact_type is free text; no new provider taxonomy or name-based merge. */
export const providerContactCreateSchema = z.object({ task_id: uuid, request_key: key, name: z.string().trim().min(1).max(200), contact_type: z.string().trim().min(1).max(80) }).strict();
export const providerContactReplySchema = z.object({ task_id: uuid, resident_id: uuid, contact: z.object({ id: uuid, label: z.string(), type: z.string() }).strict() }).strict();
