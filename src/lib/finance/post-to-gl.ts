import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type PostResult =
  | { ok: true; journalEntryId: string; alreadyPosted?: boolean }
  | { ok: false; error: string };

type PostingRpc = (
  name: "post_source_to_gl",
  args: { p_source_type: "invoice" | "payment"; p_source_id: string },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function postSourceToGl(
  supabase: SupabaseClient<Database>,
  sourceType: "invoice" | "payment",
  sourceId: string,
): Promise<PostResult> {
  try {
    // Narrow migration340 boundary avoids regenerating unrelated database types.
    const rpc = supabase.rpc.bind(supabase) as unknown as PostingRpc;
    const { data, error } = await rpc("post_source_to_gl", {
      p_source_type: sourceType,
      p_source_id: sourceId,
    });
    if (error) return { ok: false, error: error.message };
    if (!data || typeof data !== "object" || !("journal_entry_id" in data)
      || typeof data.journal_entry_id !== "string" || !data.journal_entry_id
      || !("already_posted" in data) || typeof data.already_posted !== "boolean") {
      return { ok: false, error: "GL posting did not return a complete receipt. Retry to check the source journal." };
    }
    return { ok: true, journalEntryId: data.journal_entry_id, alreadyPosted: data.already_posted };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GL posting response unavailable. Retry to check the source journal." };
  }
}

/** Atomic invoice debit/credit posting; active rules override AR/revenue defaults. */
export function postInvoiceToGl(supabase: SupabaseClient<Database>, invoiceId: string): Promise<PostResult> {
  return postSourceToGl(supabase, "invoice", invoiceId);
}

/** Atomic payment debit/credit posting; active rules override cash/AR defaults. */
export function postPaymentToGl(supabase: SupabaseClient<Database>, paymentId: string): Promise<PostResult> {
  return postSourceToGl(supabase, "payment", paymentId);
}
