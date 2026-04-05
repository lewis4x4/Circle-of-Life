import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type PostResult =
  | { ok: true; journalEntryId: string; alreadyPosted?: boolean }
  | { ok: false; error: string };

type GlSettings = {
  accounts_receivable_id: string | null;
  cash_id: string | null;
  revenue_id: string | null;
};

async function loadGlSettings(
  supabase: SupabaseClient<Database>,
  entityId: string,
): Promise<GlSettings | null> {
  const { data } = await supabase
    .from("entity_gl_settings")
    .select("accounts_receivable_id, cash_id, revenue_id")
    .eq("entity_id", entityId)
    .maybeSingle();
  return data as GlSettings | null;
}

async function getCurrentUserId(supabase: SupabaseClient<Database>): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Post an invoice to the GL as a balanced journal entry.
 * Debit: Accounts Receivable (invoice total)
 * Credit: Revenue (invoice total)
 */
export async function postInvoiceToGl(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<PostResult> {
  const existing = await supabase
    .from("journal_entries")
    .select("id")
    .eq("source_type", "invoice")
    .eq("source_id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing.data) {
    return { ok: true, journalEntryId: existing.data.id, alreadyPosted: true };
  }

  const invRes = await supabase
    .from("invoices")
    .select("id, entity_id, facility_id, organization_id, invoice_number, invoice_date, total, status")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  const invoice = invRes.data as {
    id: string;
    entity_id: string;
    facility_id: string;
    organization_id: string;
    invoice_number: string;
    invoice_date: string;
    total: number;
    status: string;
  } | null;

  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.total <= 0) return { ok: false, error: "Invoice total must be positive." };

  const settings = await loadGlSettings(supabase, invoice.entity_id);
  if (!settings?.accounts_receivable_id || !settings?.revenue_id) {
    return { ok: false, error: "GL settings missing: configure AR and Revenue accounts in Finance → GL Settings." };
  }

  const userId = await getCurrentUserId(supabase);
  if (!userId) return { ok: false, error: "Not authenticated." };

  const now = new Date().toISOString();
  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert({
      organization_id: invoice.organization_id,
      entity_id: invoice.entity_id,
      facility_id: invoice.facility_id,
      entry_date: invoice.invoice_date,
      memo: `Invoice ${invoice.invoice_number}`,
      status: "draft" as const,
      source_type: "invoice",
      source_id: invoice.id,
    })
    .select("id")
    .single();

  if (jeErr || !je) {
    if (jeErr?.code === "23505") {
      return { ok: false, error: "Invoice already posted to GL." };
    }
    return { ok: false, error: jeErr?.message ?? "Failed to create journal entry." };
  }

  const jid = je.id as string;
  const lines: Database["public"]["Tables"]["journal_entry_lines"]["Insert"][] = [
    {
      journal_entry_id: jid,
      organization_id: invoice.organization_id,
      gl_account_id: settings.accounts_receivable_id,
      line_number: 1,
      description: `AR — Invoice ${invoice.invoice_number}`,
      debit_cents: invoice.total,
      credit_cents: 0,
    },
    {
      journal_entry_id: jid,
      organization_id: invoice.organization_id,
      gl_account_id: settings.revenue_id,
      line_number: 2,
      description: `Revenue — Invoice ${invoice.invoice_number}`,
      debit_cents: 0,
      credit_cents: invoice.total,
    },
  ];

  const { error: lErr } = await supabase.from("journal_entry_lines").insert(lines);
  if (lErr) {
    await supabase.from("journal_entries").update({ deleted_at: now }).eq("id", jid);
    return { ok: false, error: lErr.message };
  }

  const { error: postErr } = await supabase
    .from("journal_entries")
    .update({ status: "posted" as const, posted_at: now, posted_by: userId })
    .eq("id", jid)
    .eq("status", "draft");

  if (postErr) {
    return { ok: false, error: `Journal created as draft but failed to post: ${postErr.message}` };
  }

  return { ok: true, journalEntryId: jid };
}

/**
 * Post a payment to the GL as a balanced journal entry.
 * Debit: Cash (payment amount)
 * Credit: Accounts Receivable (payment amount)
 */
export async function postPaymentToGl(
  supabase: SupabaseClient<Database>,
  paymentId: string,
): Promise<PostResult> {
  const existing = await supabase
    .from("journal_entries")
    .select("id")
    .eq("source_type", "payment")
    .eq("source_id", paymentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing.data) {
    return { ok: true, journalEntryId: existing.data.id, alreadyPosted: true };
  }

  const payRes = await supabase
    .from("payments")
    .select("id, entity_id, facility_id, organization_id, payment_date, amount, reference_number, payer_name, invoice_id")
    .eq("id", paymentId)
    .is("deleted_at", null)
    .maybeSingle();

  const payment = payRes.data as {
    id: string;
    entity_id: string;
    facility_id: string;
    organization_id: string;
    payment_date: string;
    amount: number;
    reference_number: string | null;
    payer_name: string | null;
    invoice_id: string | null;
  } | null;

  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.amount <= 0) return { ok: false, error: "Payment amount must be positive." };

  const settings = await loadGlSettings(supabase, payment.entity_id);
  if (!settings?.accounts_receivable_id || !settings?.cash_id) {
    return { ok: false, error: "GL settings missing: configure AR and Cash accounts in Finance → GL Settings." };
  }

  const userId = await getCurrentUserId(supabase);
  if (!userId) return { ok: false, error: "Not authenticated." };

  const now = new Date().toISOString();
  const ref = payment.reference_number ? ` ref ${payment.reference_number}` : "";
  const payer = payment.payer_name ? ` from ${payment.payer_name}` : "";
  const memo = `Payment${payer}${ref}`;

  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert({
      organization_id: payment.organization_id,
      entity_id: payment.entity_id,
      facility_id: payment.facility_id,
      entry_date: payment.payment_date,
      memo,
      status: "draft" as const,
      source_type: "payment",
      source_id: payment.id,
    })
    .select("id")
    .single();

  if (jeErr || !je) {
    if (jeErr?.code === "23505") {
      return { ok: false, error: "Payment already posted to GL." };
    }
    return { ok: false, error: jeErr?.message ?? "Failed to create journal entry." };
  }

  const jid = je.id as string;
  const lines: Database["public"]["Tables"]["journal_entry_lines"]["Insert"][] = [
    {
      journal_entry_id: jid,
      organization_id: payment.organization_id,
      gl_account_id: settings.cash_id,
      line_number: 1,
      description: `Cash — Payment${ref}`,
      debit_cents: payment.amount,
      credit_cents: 0,
    },
    {
      journal_entry_id: jid,
      organization_id: payment.organization_id,
      gl_account_id: settings.accounts_receivable_id,
      line_number: 2,
      description: `AR — Payment${ref}`,
      debit_cents: 0,
      credit_cents: payment.amount,
    },
  ];

  const { error: lErr } = await supabase.from("journal_entry_lines").insert(lines);
  if (lErr) {
    await supabase.from("journal_entries").update({ deleted_at: now }).eq("id", jid);
    return { ok: false, error: lErr.message };
  }

  const { error: postErr } = await supabase
    .from("journal_entries")
    .update({ status: "posted" as const, posted_at: now, posted_by: userId })
    .eq("id", jid)
    .eq("status", "draft");

  if (postErr) {
    return { ok: false, error: `Journal created as draft but failed to post: ${postErr.message}` };
  }

  return { ok: true, journalEntryId: jid };
}
