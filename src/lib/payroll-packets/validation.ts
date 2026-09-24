import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import type { PayrollPolicy } from "./types";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time");
const timeZoneSchema = z.string().min(1).max(80).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Choose a valid time zone");
const minutes = z.number().int().min(0).max(44640);
const cents = z.number().int().min(0).max(2147483647);
export const payrollPolicySchema = z.object({
  employerName: z.string().trim().min(1).max(160),
  payFrequency: z.enum(["weekly", "biweekly"]),
  anchorDate: dateSchema,
  workweekDay: z.number().int().min(0).max(6),
  workweekTime: timeSchema,
  timeZone: timeZoneSchema,
  overtimeThresholdMinutes: z.number().int().min(1).max(10080),
  overtimeFacilityIds: z.array(databaseUuidSchema).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Select each facility once"),
  calculationMode: z.enum(["automatic", "reviewed"]),
  mealPolicy: z.enum(["punched_unpaid", "paid"]),
  roundingMinutes: z.union([z.literal(0), z.literal(5), z.literal(6), z.literal(15)]),
  salaryTreatment: z.enum(["hours", "amount", "unchanged"]),
  approvalRole: z.enum(["central", "facility"]),
  defaultMethod: z.enum(["phone", "run"]),
  policyNote: z.string().trim().min(1).max(2000),
}).strict();
export function validatePolicyConfig(value: unknown, requireComplete: boolean): Partial<PayrollPolicy> {
  return requireComplete ? payrollPolicySchema.parse(value) : payrollPolicySchema.partial().parse(value);
}
export const packetInputSchema = z.object({
  staffId: databaseUuidSchema,
  payrollId: z.string().trim().max(80),
  payBasis: z.enum(["hourly", "salary"]).nullable(),
  department: z.enum(["administration", "operations"]),
  regularMinutes: minutes.nullable(),
  overtimeMinutes: minutes.nullable(),
  holidayMinutes: minutes,
  personalMinutes: minutes,
  trainingMinutes: minutes,
  onCallCents: cents,
  bonusCents: cents,
  salaryCents: cents.nullable(),
  note: z.string().trim().max(2000),
  reason: z.string().trim().max(1000),
  reviewed: z.boolean(),
}).strict();
export const packetInputsSchema = z.array(packetInputSchema).max(1000).refine((rows) => new Set(rows.map((row) => row.staffId)).size === rows.length, "Each employee may appear only once");
export const createPacketSchema = z.object({
  facilityId: databaseUuidSchema, periodStart: dateSchema, periodEnd: dateSchema, checkDate: dateSchema,
}).strict().refine((value) => {
  const days = (Date.parse(value.periodEnd) - Date.parse(value.periodStart)) / 86400000;
  const checkDelay = (Date.parse(value.checkDate) - Date.parse(value.periodEnd)) / 86400000;
  return days >= 0 && days < 31 && checkDelay >= 0 && checkDelay <= 366;
}, "Choose a period of 1 to 31 days and a check date from its end through the following year");
const revision = z.number().int().min(1);
export const packetActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedRevision: revision, inputs: packetInputsSchema, checkDate: dateSchema.optional() }).strict(),
  z.object({ action: z.literal("refresh"), expectedRevision: revision }).strict(),
  z.object({ action: z.literal("approve"), expectedRevision: revision }).strict(),
  z.object({ action: z.literal("report"), expectedRevision: revision, method: z.enum(["phone", "run"]), reference: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("reconcile"), expectedRevision: revision, matches: z.literal(true), note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("difference"), expectedRevision: revision, note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("amend"), expectedRevision: revision, reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export const policyRequestSchema = z.object({ facilityId: databaseUuidSchema, config: payrollPolicySchema.partial(), confirm: z.boolean(), expectedRevision: z.number().int().min(0) }).strict();
