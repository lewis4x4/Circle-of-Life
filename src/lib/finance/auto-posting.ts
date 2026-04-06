/**
 * Module 17 Enhanced — automated GL posting from billing sources.
 * Account resolution: active `gl_posting_rules` for `invoice` / `payment` override `entity_gl_settings`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostResult } from "./post-to-gl";
import { postInvoiceToGl, postPaymentToGl } from "./post-to-gl";
import type { Database } from "@/types/database";

export type { PostResult } from "./post-to-gl";
export { postInvoiceToGl, postPaymentToGl } from "./post-to-gl";

export async function batchPostInvoicesToGl(
  supabase: SupabaseClient<Database>,
  invoiceIds: string[],
): Promise<Array<{ invoiceId: string } & PostResult>> {
  const out: Array<{ invoiceId: string } & PostResult> = [];
  for (const invoiceId of invoiceIds) {
    const r = await postInvoiceToGl(supabase, invoiceId);
    out.push({ invoiceId, ...r });
  }
  return out;
}

export async function batchPostPaymentsToGl(
  supabase: SupabaseClient<Database>,
  paymentIds: string[],
): Promise<Array<{ paymentId: string } & PostResult>> {
  const out: Array<{ paymentId: string } & PostResult> = [];
  for (const paymentId of paymentIds) {
    const r = await postPaymentToGl(supabase, paymentId);
    out.push({ paymentId, ...r });
  }
  return out;
}
