import { z } from "zod";

// PostgreSQL bigint bounds. JSON carries decimal strings, never rounded numbers.
export const MAX_CENTS = BigInt("9223372036854775807");
export function cents(value: string): bigint {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") throw new Error("Invalid integer cents");
  const result = BigInt(value);
  if (result > MAX_CENTS || result < -MAX_CENTS) throw new Error("Cents exceed storage bounds");
  return result;
}
export function sumCents(values: readonly string[]): string {
  return cents(values.reduce((total, value) => total + cents(value), BigInt(0)).toString()).toString();
}
export function decimalAmount(value: string): string {
  const amount = cents(value);
  const absolute = amount < BigInt(0) ? -amount : amount;
  return `${amount < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
const amountSchema = z.string().refine((value) => {
  try { return cents(value) > BigInt(0); } catch { return false; }
}, "Positive integer cents within storage bounds required");
const providerReference = z.string().regex(/^[1-9]\d{0,19}$/);
const lineSchema = z.strictObject({
  accountReference: providerReference,
  side: z.enum(["debit", "credit"]),
  amountCents: amountSchema,
});
/** Structural privacy boundary, not a de-identification or live-release approval. */
export const summaryPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  companyReference: providerReference,
  batchReference: z.uuid(),
  accountingDate: z.iso.date(),
  currency: z.literal("USD"),
  lines: z.array(lineSchema).min(2).max(1000),
}).superRefine((payload, context) => {
  try {
    const debit = sumCents(payload.lines.filter((line) => line.side === "debit").map((line) => line.amountCents));
    const credit = sumCents(payload.lines.filter((line) => line.side === "credit").map((line) => line.amountCents));
    if (debit !== credit) context.addIssue({ code: "custom", message: "Journal must balance" });
  } catch {
    context.addIssue({ code: "custom", message: "Aggregate exceeds storage bounds" });
  }
});
export type SummaryPayload = z.infer<typeof summaryPayloadSchema>;
