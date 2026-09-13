import { z } from "zod";
import { databaseUuidSchema } from "./database-uuid";
import { recordWorkPayloadSchema } from "./receipts";

export const RESIDENT_REVIEW_FAMILIES = ["rounding", "vital_observation", "form_1823", "resident_contact"] as const;
export type ResidentReviewFamily = (typeof RESIDENT_REVIEW_FAMILIES)[number];
export const residentReviewFamilySchema = z.enum(RESIDENT_REVIEW_FAMILIES);
const date = z.iso.date();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const requestKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
export const residentReviewPeriodSchema = z.object({ start_date: date, end_date: date }).strict()
  .refine(value => value.start_date <= value.end_date, "Review period is reversed");
export const residentReviewReferenceSchema = z.object({ family: residentReviewFamilySchema, source_id: databaseUuidSchema, source_version: revision }).strict();
export const recordResidentSourceReviewSchema = z.object({
  request_key: requestKey, expected_occurrence_revision: revision,
  period: residentReviewPeriodSchema,
  references: z.array(residentReviewReferenceSchema).min(1).max(32),
  payload: recordWorkPayloadSchema,
}).strict().superRefine((value, context) => {
  if (value.payload.performed_at !== undefined || (value.payload.entry_kind && value.payload.entry_kind !== "routine")
    || (value.payload.performer && value.payload.performer.kind !== "self")) {
    context.addIssue({ code: "custom", path: ["payload"], message: "Version-pinned source reviews are current and self-recorded. Use the existing manual pathway for historical or on-behalf review without claiming current-version proof." });
  }
  const keys = value.references.map(reference => `${reference.family}:${reference.source_id.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["references"], message: "Choose each source only once" });
});
export const recheckResidentSourceReviewSchema = z.object({ request_key: requestKey, reference_id: databaseUuidSchema }).strict();
export type RecordResidentSourceReview = z.infer<typeof recordResidentSourceReviewSchema>;
export type ResidentSourceCandidate = {
  source_id: string; source_version: string; source_at: string | null;
  label: string; evidence_meaning: string;
};
export type ResidentSourceCandidatesReply = {
  task_id: string; subject_kind: string | null; eligible: boolean;
  period: { start_date: string; end_date: string };
  allowed_families: ResidentReviewFamily[]; family: ResidentReviewFamily | null;
  availability: "available" | "unavailable"; reason: string | null;
  items: ResidentSourceCandidate[]; next_cursor: string | null; complete: boolean;
};
export type ResidentSourceCheckState = "current" | "changed" | "unavailable";
export type ResidentReviewHistoryReply = {
  task_id: string;
  reviews: {
    receipt_id: string; recorded_at: string; recorder_id: string;
    references: {
      reference_id: string; family: ResidentReviewFamily | null;
      source_id: string | null; source_version: string | null;
      period: { start_date: string; end_date: string } | null;
      linked_at: string; current_state: ResidentSourceCheckState; requires_review: boolean;
      checks: { checked_at: string; checked_by: string; state: ResidentSourceCheckState }[];
    }[];
  }[];
};

const sourceCandidateSchema = z.object({
  source_id: databaseUuidSchema, source_version: revision,
  source_at: z.string().nullable(), label: z.string(), evidence_meaning: z.string(),
}).strict();
export const residentSourceCandidatesReplySchema = z.object({
  task_id: databaseUuidSchema, subject_kind: z.string().nullable(), eligible: z.boolean(),
  allowed_families: z.array(residentReviewFamilySchema), family: residentReviewFamilySchema.nullable(),
  period: residentReviewPeriodSchema, availability: z.enum(["available", "unavailable"]), reason: z.string().nullable(),
  items: z.array(sourceCandidateSchema).max(100), next_cursor: databaseUuidSchema.nullable(), complete: z.boolean(),
}).strict();

export const residentReviewHistoryReplySchema = z.object({
  task_id: databaseUuidSchema,
  reviews: z.array(z.object({
    receipt_id: databaseUuidSchema, recorded_at: z.string(), recorder_id: databaseUuidSchema,
    references: z.array(z.object({
      reference_id: databaseUuidSchema, family: residentReviewFamilySchema.nullable(),
      source_id: databaseUuidSchema.nullable(), source_version: revision.nullable(),
      period: residentReviewPeriodSchema.nullable(), linked_at: z.string(),
      current_state: z.enum(["current", "changed", "unavailable"]), requires_review: z.boolean(),
      checks: z.array(z.object({ checked_at: z.string(), checked_by: databaseUuidSchema, state: z.enum(["current", "changed", "unavailable"]) }).strict()),
    }).strict()),
  }).strict()),
}).strict();
