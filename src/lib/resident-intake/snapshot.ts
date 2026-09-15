import { NextResponse } from "next/server";
import { z } from "zod";

import type { CurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { databaseIdSchema, mapResidentIntakeRpcError, recordRevisionSchema, residentDocumentClassSchema, sourceClassificationSchema } from "./schemas";

const id = databaseIdSchema;

const publicIntakeSchema = z.object({
  id,
  facility_id: id,
  resident_id: id.nullable(),
  admission_case_id: id.nullable(),
  title: z.string().max(200),
  state: z.string().min(1).max(80),
  parser_state: z.string().min(1).max(80),
  revision: recordRevisionSchema,
  source_count: z.number().int().nonnegative(),
  finalized_source_count: z.number().int().nonnegative(),
  quarantined_source_count: z.number().int().nonnegative(),
  applied_fact_count: z.number().int().nonnegative(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
}).strip();

export const publicIntakeSourceSchema = z.object({
  id,
  source_order: z.number().int().positive(),
  title: z.string().max(255),
  original_filename: z.string().max(255),
  declared_mime: z.string().max(100),
  declared_size_bytes: z.number().int().positive(),
  state: z.string().min(1).max(80),
  revision: recordRevisionSchema,
  source_class: z.enum(["unclassified", ...sourceClassificationSchema.options]),
  document_type: residentDocumentClassSchema.nullable(),
  classification_confidence: z.coerce.number().min(0).max(1).nullable(),
  classification_reason_code: z.string().max(80).nullable(),
  preflight_state: z.enum(["needs_confirmation", "safe", "credential_detected", "overridden", "not_applicable"]),
  credential_quarantined: z.boolean(),
  page_count: z.number().int().positive().nullable(),
  canonical_document_id: id.nullable(),
  promotion_mode: z.enum(["add", "replace"]).nullable(),
  supersedes_document_id: id.nullable(),
  finalized_at: z.string().nullable(),
}).strip();

const publicFactSchema = z.object({
  id,
  source_id: id,
  fact_key: id,
  fact_version: z.number().int().positive(),
  field_code: z.string().min(1).max(120),
  domain: z.enum(["demographics", "clinical", "payer", "legal", "authority", "admission", "contact", "screening"]),
  structured_value: z.unknown(),
  display_value: z.string().max(2_000),
  page_start: z.number().int().positive().nullable(),
  page_end: z.number().int().positive().nullable(),
  confidence: z.coerce.number().min(0).max(1).nullable(),
  canonical_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  current_value: z.unknown().optional(),
  current_display_value: z.string().max(2_000).nullable().optional(),
  conflict: z.boolean(),
  conflict_code: z.string().max(80).nullable(),
  required_reviewer: z.enum(["operational", "clinical", "payer", "legal", "authority"]),
  state: z.enum(["proposed", "approved", "rejected", "superseded", "stale", "applied"]),
  revision: recordRevisionSchema,
  review_reason: z.string().max(2_000).nullable(),
  reviewed_at: z.string().nullable(),
  applied_destination: z.string().max(100).nullable(),
  applied_record_id: id.nullable(),
}).strip();

const publicMatchSchema = z.object({
  id,
  candidate_resident_id: id.nullable(),
  candidate_kind: z.string().min(1).max(80),
  confidence: z.coerce.number().min(0).max(1).nullable(),
  match_basis: z.array(z.string().max(100)).max(100),
  disposition: z.string().min(1).max(80),
  reason: z.string().max(2_000).nullable(),
  reviewed_at: z.string().nullable(),
  candidate_first_name: z.string().max(100).nullable().optional(),
  candidate_middle_name: z.string().max(100).nullable().optional(),
  candidate_last_name: z.string().max(100).nullable().optional(),
  candidate_date_of_birth: z.string().nullable().optional(),
  candidate_status: z.string().max(80).nullable().optional(),
}).strip();

const publicChecklistItemSchema = z.object({
  document_type: z.string().min(1).max(100),
  state: z.string().min(1).max(80),
  source_id: id.nullable().optional(),
  resident_document_id: id.nullable().optional(),
  label: z.string().max(200).optional(),
}).strip();

export const residentIntakeSnapshotSchema = z.object({
  intake: publicIntakeSchema,
  sources: z.array(publicIntakeSourceSchema).max(2_000),
  facts: z.array(publicFactSchema).max(10_000),
  matches: z.array(publicMatchSchema).max(2_000),
  checklist: z.array(publicChecklistItemSchema).max(1_000).optional().default([]),
  counts: z.record(z.string().min(1).max(80), z.number().int().nonnegative()),
  can: z.object({
    read: z.boolean(),
    manage: z.boolean(),
    clinical: z.boolean(),
    payer: z.boolean(),
    legal: z.boolean(),
  }).strict(),
}).strict();

export type ResidentIntakeSnapshot = z.infer<typeof residentIntakeSnapshotSchema>;

export async function readResidentIntakeSnapshot(actor: CurrentApiActor, intakeId: string) {
  const { data, error } = await actor.client.rpc(
    "resident_record_intake_snapshot" as never,
    { p_intake_id: intakeId } as never,
  );
  if (error) {
    logError("resident-intake.snapshot", error, { intakeId });
    return { error: mapResidentIntakeRpcError(error, "snapshot") } as const;
  }
  const parsed = residentIntakeSnapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.intake.id !== intakeId) {
    return { error: { status: 503, outcome: "uncertain" as const, error: "Resident intake response could not be verified" } } as const;
  }
  const credentialSourceIds = new Set(parsed.data.sources.filter((source) => source.credential_quarantined || source.source_class === "credential_secret").map((source) => source.id));
  return {
    snapshot: {
      ...parsed.data,
      facts: parsed.data.facts.filter((fact) => !credentialSourceIds.has(fact.source_id)),
    },
  } as const;
}

export function snapshotErrorResponse(error: { status: number; outcome: string; error: string }) {
  return NextResponse.json({ error: error.error, outcome: error.outcome }, { status: error.status, headers: { "Cache-Control": "no-store" } });
}
