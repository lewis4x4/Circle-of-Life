import { z } from 'zod';
import { dateSchema, idSchema } from './workspace-schema';
import { SERVICING_KINDS, SERVICING_STATUSES } from './servicing-types';
const text = z.string().max(10000);
const draftDate = z.union([dateSchema, z.literal('')]);
const draftId = z.union([idSchema, z.literal('')]);
const nullableId = idSchema.nullable();
const page = z.number().int().positive().max(100000).nullable();
const cents = z.number().int().nonnegative().max(2147483647).nullable();
const version = z.number().int().positive();
const states = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'] as const;
export const servicingPayloadSchemas = {
  renewal_package: z.object({
    period_start: draftDate,
    period_end: draftDate,
    document_ids: z.array(idSchema).max(1000),
    location_changes: text,
    exposures: text,
    open_questions: text,
    recipient: text
  }).strict(),
  vendor_evidence: z.object({
    vendor_id: draftId,
    contract_id: nullableId,
    requirements: text,
    requires_endorsement: z.boolean(),
    endorsement_document_id: nullableId,
    endorsement_page: page,
    assessment: text,
    exception_reason: text.nullable(),
    expiration_date: draftDate
  }).strict(),
  loss_report: z.object({
    carrier_name: text,
    valuation_date: draftDate,
    period_start: draftDate,
    period_end: draftDate,
    coverage_line: text,
    complete_periods: z.boolean(),
    no_losses_confirmed: z.boolean(),
    no_loss_evidence_page: page,
    claims: z.array(z.object({
      claim_reference: z.string().max(500),
      loss_date: dateSchema.nullable(),
      paid_cents: cents,
      reserve_cents: cents,
      recovery_cents: cents,
      expense_cents: cents,
      incurred_cents: cents,
      incurred_includes_expenses: z.boolean().nullable(),
      page
    }).strict()).max(1000)
  }).strict(),
  claim_matter: z.object({
    incident_id: nullableId,
    carrier_reference: text.nullable(),
    loss_date: draftDate,
    reported_date: dateSchema.nullable(),
    recipient: text.nullable(),
    acknowledgment: text.nullable(),
    next_action: text,
    description: text
  }).strict(),
  workforce_exposure: z.object({
    period_start: draftDate,
    period_end: draftDate,
    broker_mapping_confirmed: z.boolean(),
    rows: z.array(z.object({
      state: z.union([z.enum(states), z.literal('')]),
      class_code: z.string().max(80),
      estimated_payroll_cents: cents,
      actual_payroll_cents: cents,
      basis_note: text
    }).strict()).max(1000),
    notes: text,
    manual_source_reason: text.nullable()
  }).strict()
};
const saveEnvelope = z.object({
  id: idSchema,
  version: version.optional(),
  kind: z.enum(SERVICING_KINDS),
  title: z.string().trim().min(1).max(500),
  entity_id: idSchema,
  facility_id: nullableId,
  policy_id: nullableId,
  document_id: nullableId,
  owner_id: nullableId,
  due_date: dateSchema.nullable(),
  payload: z.unknown()
}).strict();
const commandSchemas = {
  list: z.object({
    kind: z.enum(SERVICING_KINDS).optional()
  }).strict(),
  transition: z.object({
    id: idSchema,
    version,
    status: z.enum(SERVICING_STATUSES),
    note: text.optional(),
    recipient: text.optional(),
    acknowledgment: text.optional(),
    reported_date: dateSchema.optional()
  }).strict(),
  revise: z.object({
    id: idSchema,
    version,
    new_id: idSchema
  }).strict(),
  reassign: z.object({
    id: idSchema,
    version,
    owner_id: nullableId,
    due_date: dateSchema.nullable(),
    note: z.string().trim().min(1).max(10000)
  }).strict(),
  export: z.object({
    id: idSchema,
    version
  }).strict()
};
export type ServicingAction = 'save' | keyof typeof commandSchemas;
export function parseServicingCommand(raw: unknown) {
  const envelope = z.object({
    action: z.enum(['list', 'save', 'transition', 'revise', 'reassign', 'export']),
    payload: z.unknown()
  }).strict().parse(raw);
  if (envelope.action === 'save') {
    const save = saveEnvelope.parse(envelope.payload);
    return {
      action: envelope.action,
      payload: {
        ...save,
        payload: servicingPayloadSchemas[save.kind].parse(save.payload)
      }
    };
  }
  return {
    action: envelope.action,
    payload: commandSchemas[envelope.action].parse(envelope.payload)
  };
}
