import type { SupabaseClient } from "@supabase/supabase-js";
import { isNotYetSentStatus } from "@/lib/billing/receivables";
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

/**
 * Why an invoice cannot be posted right now, in words, or null when it can.
 * A draft is not billed (the database refuses to post it — migration 340), and
 * an entity with no chart of accounts has nowhere to post to.
 */
export function glPostUnavailableReason(input: {
  status: string;
  totalCents: number;
  /** Null while the chart-of-accounts check is still loading. */
  glAccountCount: number | null;
}): string | null {
  if (isNotYetSentStatus(input.status)) return "Drafts are not billed. Send this invoice before posting it to the general ledger.";
  if (input.totalCents <= 0) return "This invoice has no amount to post.";
  if (input.glAccountCount == null) return "Checking the chart of accounts…";
  if (input.glAccountCount === 0) return "This entity has no chart of accounts yet, so there is nowhere to post.";
  return null;
}
