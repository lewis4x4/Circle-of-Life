import { z } from "zod";
import { databaseUuidSchema } from "./database-uuid";

export const financeSourceFamilySchema = z.enum(["census", "payments", "trust", "finance_handoff"]);
export type FinanceSourceFamily = z.infer<typeof financeSourceFamilySchema>;
const date = z.iso.date();
export const financeSourcePeriodSchema = z.object({ task_id: databaseUuidSchema, start_date: date, end_date: date }).strict().refine(value => {
  const days = (Date.parse(value.end_date) - Date.parse(value.start_date)) / 86400000;
  return days >= 0 && days < 366;
}, "Choose an inclusive period of 1 to 366 days");
export const financeSourceReconcileSchema = financeSourcePeriodSchema.safeExtend({ request_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/) });
const cents = z.string().regex(/^-?\d+$/).nullable().optional();
export const financeSourceMetricsSchema = z.object({
  total_licensed_beds: z.number().int().optional(), occupied_beds: z.number().int().optional(), available_beds: z.number().int().optional(),
  hold_beds: z.number().int().optional(), maintenance_beds: z.number().int().optional(), admissions_today: z.number().int().optional(), discharges_today: z.number().int().optional(),
  allocated_cents: cents, unapplied_cents: cents, invoice_id: databaseUuidSchema.nullable().optional(), account_id: databaseUuidSchema.nullable().optional(),
  direction: z.enum(["deposit", "withdrawal"]).optional(), canonical_balance_cents: cents, legacy_balance_cents: cents,
  legacy_review_required: z.boolean().optional(), external_reconciliation: z.literal("NOT_VERIFIED").optional(),
  dispatch_enabled: z.literal(false).optional(), accounting_classification: z.literal("unverified").optional(), external_acknowledgment: z.literal("unavailable").optional(),
}).strict();
export const financeSourceRecordSchema = z.object({
  id: databaseUuidSchema, version: z.string().regex(/^[a-f0-9]{64}$/), native_version: z.string().nullable(),
  economic_date: date.nullable(), service_period_start: date.nullable(), service_period_end: date.nullable(), recorded_at: z.string().nullable(),
  state: z.string(), amount_cents: z.string().regex(/^-?\d+$/).nullable(), metrics: financeSourceMetricsSchema,
}).strict();
const family = z.object({ family: financeSourceFamilySchema, availability: z.enum(["available", "unavailable"]), reason: z.string(), records: z.array(financeSourceRecordSchema).max(5000), missing_dates: z.array(date).max(366) }).strict();
export const financeSourceInputSchema = z.object({
  task_id: databaseUuidSchema, activity_key: z.string(), subject_kind: z.string(), resident_id: databaseUuidSchema.nullable(), facility_id: databaseUuidSchema,
  start_date: date, end_date: date, timezone: z.string(), source_version: z.string().regex(/^[a-f0-9]{64}$/), complete: z.literal(true),
  families: z.array(family).length(4).refine(rows => new Set(rows.map(row => row.family)).size === 4),
  history: z.array(z.object({ id: databaseUuidSchema, observed_at: z.string(), source_version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(100), history_complete: z.boolean(),
}).strict();
export type FinanceSourceInput = z.infer<typeof financeSourceInputSchema>;
export type FinanceSourceRecord = z.infer<typeof financeSourceRecordSchema>;
export type FinanceSourceMapping = { sourceId: string; key: string; label: string; kind: string; families: FinanceSourceFamily[]; gap: string | null };
const field = z.object({ source_id: z.string(), component_key: z.string(), label: z.string(), kind: z.string(), families: z.array(financeSourceFamilySchema), reason: z.string(), state: z.enum(["context_only", "unavailable", "unknown"]) }).strict();
export const financeSourcesReplySchema = financeSourceInputSchema.extend({ fields: z.array(field).length(27) });
export type FinanceSourcesReply = z.infer<typeof financeSourcesReplySchema>;
export function composeFinanceSources(input: FinanceSourceInput, mapping: readonly FinanceSourceMapping[]): FinanceSourcesReply {
  return financeSourcesReplySchema.parse({ ...input, fields: mapping.map(item => ({ source_id: item.sourceId, component_key: item.key, label: item.label, kind: item.kind, families: item.families,
    state: item.gap ? "unknown" : item.families.length && item.families.some(name => input.families.find(row => row.family === name)?.availability === "available") ? "context_only" : "unavailable",
    reason: item.gap ?? "Native source context only. No administrative performance, billable days, deposit or external acknowledgment is inferred.",
  })) });
}
