import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Home W2 (COL-594): Record payment. The database command decides everything
 * that matters — release switch, finance authority, oldest open invoice, the
 * mismatch rule — so this module only shapes input and names the outcomes.
 */

export const PAYMENT_METHODS = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "credit_card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/** "$1,234.50" → 123450. Anything that is not a positive amount with at most two decimals is null. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_147_483_647 ? cents : null;
}

/** Object name the bucket policy and the command both check: <facility>/<payment>/<file>. */
export function evidencePath(facilityId: string, paymentId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) : "";
  return `${facilityId}/${paymentId}/check${ext ? `.${ext}` : ""}`;
}

export type RecordPaymentInput = {
  paymentId: string;
  facilityId: string;
  residentId: string;
  paymentDate: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string;
  payerName: string;
  mismatchReason: string;
  note: string;
  photo: File;
};

export type RecordPaymentOutcome =
  | { kind: "recorded"; allocatedCents: number; unappliedCents: number; replayed: boolean }
  | { kind: "reason_required"; message: string }
  | { kind: "error"; message: string };

type RpcError = { message: string; code?: string; hint?: string | null } | null;

export async function recordPaymentOnHome(supabase: SupabaseClient, input: RecordPaymentInput): Promise<RecordPaymentOutcome> {
  const path = evidencePath(input.facilityId, input.paymentId, input.photo.name);
  // The photo is uploaded under the payment's own id, so a retry lands on the
  // same object; "already exists" is the retry, not a failure.
  const upload = await supabase.storage.from("payment-evidence").upload(path, input.photo, { upsert: false, contentType: input.photo.type || undefined });
  if (upload.error && !/exists|duplicate/i.test(upload.error.message)) {
    return { kind: "error", message: "The photo could not be uploaded. Check the connection and try again." };
  }
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await rpc("home_record_payment", {
    p_id: input.paymentId,
    p_resident_id: input.residentId,
    p_payment_date: input.paymentDate,
    p_amount_cents: input.amountCents,
    p_method: input.method,
    p_evidence_path: path,
    p_reference: input.reference.trim() || null,
    p_payer_name: input.payerName.trim() || null,
    p_mismatch_reason: input.mismatchReason.trim() || null,
    p_note: input.note.trim() || null,
  });
  if (error) {
    if (error.hint === "mismatch_reason_required") return { kind: "reason_required", message: error.message };
    return { kind: "error", message: error.message || "The payment could not be recorded." };
  }
  const result = (data ?? {}) as { allocated_cents?: number; unapplied_cents?: number; replayed?: boolean };
  return {
    kind: "recorded",
    allocatedCents: Number(result.allocated_cents ?? 0),
    unappliedCents: Number(result.unapplied_cents ?? 0),
    replayed: Boolean(result.replayed),
  };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
