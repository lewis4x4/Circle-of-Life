import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type PostResult =
  | { ok: true; journalEntryId: string; alreadyPosted?: boolean }
  | { ok: false; error: string };

async function postSourceToGl(
  supabase: SupabaseClient<Database>,
  sourceType: "invoice" | "payment",
  sourceId: string,
): Promise<PostResult> {
  const { data, error } = await supabase.rpc("post_finance_source", {
    p_source_type: sourceType,
    p_source_id: sourceId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.journal_entry_id !== "string") {
    return { ok: false, error: "Posting did not return a committed journal receipt. Retry to recover the result." };
  }
  return { ok: true, journalEntryId: data.journal_entry_id };
}

export function postInvoiceToGl(supabase: SupabaseClient<Database>, invoiceId: string): Promise<PostResult> {
  return postSourceToGl(supabase, "invoice", invoiceId);
}

export function postPaymentToGl(supabase: SupabaseClient<Database>, paymentId: string): Promise<PostResult> {
  return postSourceToGl(supabase, "payment", paymentId);
}
