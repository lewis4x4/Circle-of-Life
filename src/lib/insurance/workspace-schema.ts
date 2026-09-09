import { z } from 'zod';
import { DOCUMENT_FAMILIES, POLICY_TYPES } from './workspace-types';
export const idSchema = z.uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid calendar date');
const draftDate = z.union([dateSchema, z.literal('')]);
const draftId = z.union([idSchema, z.literal('')]);
const text = z.string().max(10000);
const money = z.number().int().min(0).max(2147483647).nullable();
const interval = {
  role: z.string().min(1).max(80), effective_from: draftDate, effective_to: dateSchema.nullable()
};
export const policyDraftSchema = z.object({
  entity_id: draftId, policy_type: z.enum(POLICY_TYPES), carrier_name: text, broker_name: text.nullable(), policy_number: text, effective_date: draftDate, expiration_date: draftDate, premium_cents: money, aggregate_limit_cents: money, occurrence_limit_cents: money, deductible_cents: money, premium_period: text.nullable(), notes: text.nullable(), shared_limit: z.boolean().nullable(), parties: z.array(z.object({ entity_id: idSchema, ...interval }).strict()).max(1000), facilities: z.array(z.object({ facility_id: idSchema, ...interval }).strict()).max(1000), coverages: z.array(z.object({
    coverage_type: z.enum(POLICY_TYPES), occurrence_limit_cents: money, aggregate_limit_cents: money, deductible_cents: money, shared_limit_group: z.string().max(160).nullable()
  }).strict()).max(100).optional(), change_effective_date: dateSchema.optional()
}).strict();
export const evidenceSchema = z.record(z.string().max(160), z.object({
  source: z.enum(['document', 'manual']), document_id: idSchema.optional(), page: z.number().int().positive().max(100000).optional(), excerpt: text.optional(), reason: text.optional()
}).strict());
const revision = z.number().int().positive();
const owner = idSchema.nullable().optional();
const commands = {
  overview: z.object({
    as_of: dateSchema.optional(), facility_id: idSchema.optional(), policy_id: idSchema.optional()
  }).strict(),
  get_document: z.object({ id: idSchema }).strict(),
  save_draft: z.object({
    id: idSchema, document_id: idSchema.optional(), kind: z.enum(['new_policy', 'endorsement', 'renewal', 'verification']), policy_id: idSchema.optional(), expected_version: z.number().int().nonnegative().optional(), revision: revision.optional(), payload: policyDraftSchema, evidence: evidenceSchema
  }).strict(),
  approve_draft: z.object({
    id: idSchema, revision, confirm_evidence: z.literal(true)
  }).strict(),
  reject_draft: z.object({
    id: idSchema, revision, reason: z.string().trim().min(1).max(10000)
  }).strict(),
  create_certificate_request: z.object({
    id: idSchema, entity_id: idSchema, facility_id: idSchema.optional(), holder_name: z.string().trim().min(1).max(1000), holder_details: text, requirements: text, owner_id: owner, due_date: dateSchema.optional()
  }).strict(),
  update_certificate_request: z.object({
    id: idSchema, version: revision, status: z.enum(['requested', 'acknowledged', 'needs_information', 'issued', 'cancelled']), document_id: idSchema.optional(), note: text.optional()
  }).strict(),
  update_work_item: z.object({
    id: idSchema, version: revision, status: z.enum(['open', 'completed', 'dismissed']), owner_id: owner, due_date: dateSchema.nullable().optional(), note: text.optional()
  }).strict(),
  configure_renewal: z.object({
    policy_id: idSchema, owner_id: idSchema, milestone_days: z.array(z.number().int().min(1).max(1095)).min(1).max(20)
  }).strict(),
};
export type WorkspaceAction = keyof typeof commands;
export function parseWorkspaceCommand(input: unknown) {
  const envelope = z.object({
    action: z.enum(Object.keys(commands) as [
      WorkspaceAction,
      ...WorkspaceAction[]
    ]), payload: z.unknown()
  }).strict().parse(input);
  return { action: envelope.action, payload: commands[envelope.action].parse(envelope.payload) };
}
export const uploadMetadataSchema = z.object({ family: z.enum(DOCUMENT_FAMILIES), facility_id: idSchema.optional() }).strict();
