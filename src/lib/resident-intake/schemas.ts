import { z } from "zod";

import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import {
  RESIDENT_DOCUMENT_CLASSES,
  RESIDENT_FACT_CODES,
  SOURCE_CLASSIFICATIONS,
  parseResidentFactValue,
  type ResidentFactCode,
} from "./fact-registry";

export const RESIDENT_INTAKE_BUCKET = "resident-intake-sources";
export const RESIDENT_INTAKE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const RESIDENT_INTAKE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const databaseIdSchema = databaseUuidSchema;
export const requestKeySchema = z.uuidv4();
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i, "Expected a SHA-256 digest").transform((value) => value.toLowerCase());
export const sourceClassificationSchema = z.enum(SOURCE_CLASSIFICATIONS);
export const residentDocumentClassSchema = z.enum(RESIDENT_DOCUMENT_CLASSES);
export const residentFactCodeSchema = z.enum(RESIDENT_FACT_CODES);
export const intakeMimeSchema = z.enum(RESIDENT_INTAKE_MIME_TYPES);

const nullableDatabaseId = databaseIdSchema.nullable().optional();
const reasonSchema = z.string().trim().min(3).max(2_000);
export const recordRevisionSchema = databaseIdSchema;
const fileNameSchema = z.string().trim().min(1).max(255).refine((value) => !/[\u0000-\u001f/\\]/.test(value), "Invalid file name");

export const createResidentIntakeBodySchema = z.object({
  facility_id: databaseIdSchema,
  admission_case_id: nullableDatabaseId,
  resident_id: nullableDatabaseId,
  title: z.string().trim().min(1).max(200).optional(),
  request_key: requestKeySchema,
}).strict();

export const prepareResidentIntakeSourceBodySchema = z.object({
  request_key: requestKeySchema,
  expected_revision: recordRevisionSchema,
  file_name: fileNameSchema,
  declared_mime: intakeMimeSchema,
  declared_size_bytes: z.number().int().min(1).max(RESIDENT_INTAKE_MAX_SOURCE_BYTES),
  declared_sha256: sha256Schema,
  source_order: z.number().int().positive().optional(),
}).strict();

export const finalizeResidentIntakeSourceBodySchema = z.object({
  request_key: requestKeySchema,
  expected_revision: recordRevisionSchema,
}).strict();

export const parseResidentIntakeBodySchema = z.object({
  source_id: databaseIdSchema,
  request_key: requestKeySchema,
  expected_revision: recordRevisionSchema,
}).strict();

const pageNumbersSchema = z.array(z.number().int().positive()).min(1).max(500).optional();
const duplicateDispositionSchema = z.enum(["confirmed_match", "cross_facility_not_transfer"]);
const provisionalDuplicateDispositionSchema = z.enum(["no_match", "not_same_person", "known_duplicate_not_linked"]);

const commandEnvelope = {
  request_key: requestKeySchema,
  expected_revision: recordRevisionSchema,
};

export const residentIntakeCommandBodySchema = z.discriminatedUnion("command", [
  z.object({ ...commandEnvelope, command: z.literal("manual_classify_source"), payload: z.object({
    source_id: databaseIdSchema,
    classification: sourceClassificationSchema,
    document_class: residentDocumentClassSchema.nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    page_count: z.number().int().positive().max(500).optional(),
    pages: z.array(z.object({
      page_number: z.number().int().positive(),
      classification: sourceClassificationSchema.optional(),
      document_class: residentDocumentClassSchema.nullable().optional(),
      disposition: z.enum(["resident_eligible", "excluded", "quarantined", "unreadable"]).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
    }).strict()).max(500).optional(),
    reason: reasonSchema,
  }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("confirm_source_safe_for_external_parse"), payload: z.object({ source_id: databaseIdSchema, reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("confirm_resident_match"), payload: z.object({ resident_id: databaseIdSchema, candidate_id: databaseIdSchema.optional(), duplicate_disposition: duplicateDispositionSchema, reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("create_provisional_resident"), payload: z.object({ first_name: z.string().trim().min(1).max(100), middle_name: z.string().trim().min(1).max(100).nullable().optional(), last_name: z.string().trim().min(1).max(100), date_of_birth: z.iso.date().nullable().optional(), gender: z.string().trim().min(1).max(100).nullable().optional(), duplicate_disposition: provisionalDuplicateDispositionSchema, reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("propose_manual_fact"), payload: z.object({ source_id: databaseIdSchema, field_code: residentFactCodeSchema, value: z.unknown(), display_value: z.string().trim().min(1).max(2_000), page_numbers: pageNumbersSchema, confidence: z.number().min(0).max(1).nullable().optional(), conflict: z.boolean().optional(), conflict_code: z.string().trim().min(1).max(80).nullable().optional(), reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("approve_fact"), payload: z.object({ fact_id: databaseIdSchema, fact_revision: recordRevisionSchema, canonical_fingerprint: sha256Schema, reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("reject_fact"), payload: z.object({ fact_id: databaseIdSchema, fact_revision: recordRevisionSchema, reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("correct_fact"), payload: z.object({ fact_id: databaseIdSchema, fact_revision: recordRevisionSchema, field_code: residentFactCodeSchema, value: z.unknown(), display_value: z.string().trim().min(1).max(2_000), page_numbers: pageNumbersSchema, conflict: z.boolean().optional(), conflict_code: z.string().trim().min(1).max(80).nullable().optional(), reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("apply_fact"), payload: z.object({ fact_id: databaseIdSchema, fact_revision: recordRevisionSchema, canonical_fingerprint: sha256Schema, promotion_mode: z.enum(["add", "replace"]).optional(), replace_document_id: databaseIdSchema.optional(), reason: reasonSchema }).strict() }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("promote_source"), payload: z.discriminatedUnion("mode", [
    z.object({ source_id: databaseIdSchema, mode: z.literal("add"), reason: reasonSchema }).strict(),
    z.object({ source_id: databaseIdSchema, mode: z.literal("replace"), resident_document_id: databaseIdSchema, supersedes_source_id: databaseIdSchema.optional(), reason: reasonSchema }).strict(),
  ]) }).strict(),
  z.object({ ...commandEnvelope, command: z.literal("complete_intake"), payload: z.object({ reason: reasonSchema }).strict() }).strict(),
]);

export type ResidentIntakeCommandBody = z.infer<typeof residentIntakeCommandBodySchema>;

export function validateResidentIntakeCommandFacts(command: ResidentIntakeCommandBody) {
  if (command.command === "propose_manual_fact") {
    return parseResidentFactValue(command.payload.field_code, command.payload.value);
  }
  if (command.command === "correct_fact") {
    return parseResidentFactValue(command.payload.field_code, command.payload.value);
  }
  return { success: true as const, data: command.payload };
}

export const providerPageSchema = z.object({
  page_number: z.number().int().positive(),
  classification: sourceClassificationSchema,
  document_class: residentDocumentClassSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
}).strict();

export const providerFactSchema = z.object({
  field_code: residentFactCodeSchema,
  value: z.unknown(),
  display_value: z.string().trim().min(1).max(2_000),
  page_numbers: z.array(z.number().int().positive()).min(1).max(500),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().trim().max(500).nullable(),
}).strict().superRefine((fact, context) => {
  const parsed = parseResidentFactValue(fact.field_code, fact.value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: `Invalid value for ${fact.field_code}` });
  }
});

export const providerExtractionSchema = z.object({
  source_classification: sourceClassificationSchema,
  document_class: residentDocumentClassSchema.nullable(),
  pages: z.array(providerPageSchema).min(1).max(500),
  facts: z.array(providerFactSchema).max(1_000),
  warnings: z.array(z.string().trim().min(1).max(300)).max(100),
}).strict().superRefine((result, context) => {
  const pageNumbers = new Set<number>();
  for (const page of result.pages) {
    if (pageNumbers.has(page.page_number)) context.addIssue({ code: "custom", message: "Duplicate page number" });
    pageNumbers.add(page.page_number);
    if (page.classification !== "resident" && page.document_class !== null) context.addIssue({ code: "custom", message: "Excluded pages cannot have a resident document class" });
  }
  for (const fact of result.facts) {
    if (fact.page_numbers.some((page) => !pageNumbers.has(page))) context.addIssue({ code: "custom", message: "Fact references an unknown page" });
  }
  if (result.source_classification !== "resident" && result.facts.length > 0) context.addIssue({ code: "custom", message: "Excluded sources cannot produce facts" });
  if (result.source_classification !== "resident" && result.document_class !== null) context.addIssue({ code: "custom", message: "Excluded sources cannot have a resident document class" });
  if (result.source_classification === "resident" && result.document_class === null) context.addIssue({ code: "custom", message: "Resident sources require a document class" });
});

export type ProviderExtraction = z.infer<typeof providerExtractionSchema>;
export type ResidentFactCodeInput = ResidentFactCode;

export const residentIntakeRowSchema = z.object({
  id: databaseIdSchema,
  organization_id: databaseIdSchema,
  facility_id: databaseIdSchema,
  resident_id: databaseIdSchema.nullable(),
  admission_case_id: databaseIdSchema.nullable(),
  title: z.string().max(200),
  state: z.string().min(1).max(80),
  parser_state: z.string().min(1).max(80).nullable().optional(),
  revision: recordRevisionSchema,
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
}).passthrough();

export const residentIntakeSourceRowSchema = z.object({
  id: databaseIdSchema,
  intake_id: databaseIdSchema,
  organization_id: databaseIdSchema,
  facility_id: databaseIdSchema,
  title: fileNameSchema,
  original_filename: fileNameSchema,
  declared_mime: intakeMimeSchema,
  declared_size_bytes: z.number().int().min(1).max(RESIDENT_INTAKE_MAX_SOURCE_BYTES),
  declared_sha256: sha256Schema,
  storage_path: z.string().min(1).max(1_024),
  state: z.string().min(1).max(80),
  revision: recordRevisionSchema,
  uploaded_by: databaseIdSchema,
  source_order: z.number().int().nonnegative().optional(),
  preflight_state: z.enum(["needs_confirmation", "safe", "credential_detected", "overridden", "not_applicable"]),
  safe_confirmed_at: z.string().nullable().optional(),
  safe_confirmed_by: databaseIdSchema.nullable().optional(),
  source_class: z.enum(["unclassified", ...SOURCE_CLASSIFICATIONS]),
  document_type: residentDocumentClassSchema.nullable().optional(),
  credential_pattern_codes: z.array(z.string().min(1).max(80)).max(50).optional(),
}).passthrough();

export type ResidentIntakeRow = z.infer<typeof residentIntakeRowSchema>;
export type ResidentIntakeSourceRow = z.infer<typeof residentIntakeSourceRowSchema>;

export type ResidentIntakeRpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export type ResidentIntakeErrorOutcome = "validation" | "denied" | "missing" | "conflict" | "retryable" | "uncertain";

export function mapResidentIntakeRpcError(
  error: ResidentIntakeRpcError,
  action: "create" | "prepare" | "finalize" | "snapshot" | "command" | "stage",
): { status: number; outcome: ResidentIntakeErrorOutcome; error: string } {
  const noun = action === "snapshot" ? "Resident intake" : `Resident intake ${action}`;
  if (error.code === "42501") return { status: 404, outcome: "missing", error: "Resident intake not found" };
  if (error.code === "P0002") return { status: 404, outcome: "missing", error: action === "snapshot" ? "Resident intake not found" : "Resident intake item not found" };
  if (["22023", "22P02", "22007", "22008", "23503"].includes(error.code ?? "")) return { status: 400, outcome: "validation", error: `${noun} contains an invalid value or reference` };
  if (["23505", "23514", "40001", "P0001"].includes(error.code ?? "")) return { status: 409, outcome: "conflict", error: `${noun} conflicts with current intake state; refresh before retrying` };
  if (["57014", "40P01", "08000", "08003", "08006"].includes(error.code ?? "")) return { status: 503, outcome: "retryable", error: `${noun} could not be confirmed; re-read before retrying with the same request key` };
  return { status: 503, outcome: "uncertain", error: `${noun} could not be confirmed; re-read before retrying` };
}
