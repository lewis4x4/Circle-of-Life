import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type InvoiceStatusUi = "draft" | "sent" | "partial" | "paid" | "overdue" | "void" | "written_off";
export type PayerTypeUi = "private_pay" | "medicaid" | "ltc_insurance";

export type BillingRow = {
  id: string;
  invoiceNumber: string;
  residentName: string;
  payerType: PayerTypeUi;
  status: InvoiceStatusUi;
  amountDueCents: number;
  dueDate: string;
  updatedAt: string;
};

type SupabaseResidentMini = {
  first_name: string | null;
  last_name: string | null;
};

type SupabaseInvoiceRow = {
  id: string;
  resident_id: string;
  invoice_number: string;
  status: string;
  balance_due: number;
  due_date: string;
  updated_at: string;
  payer_type: string | null;
  deleted_at: string | null;
  residents: SupabaseResidentMini | SupabaseResidentMini[] | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchInvoicesFromSupabase(
  selectedFacilityId: string | null,
  residentIdFilter?: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<BillingRow[]> {
  let invQuery = supabase
    .from("invoices" as never)
    .select(
      "id, resident_id, invoice_number, status, balance_due, due_date, updated_at, payer_type, deleted_at, residents!invoices_resident_id_fkey(first_name,last_name)",
    )
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })
    .limit(200);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    invQuery = invQuery.eq("facility_id", selectedFacilityId);
  }
  if (residentIdFilter && UUID_STRING_RE.test(residentIdFilter)) {
    invQuery = invQuery.eq("resident_id", residentIdFilter);
  }

  const invResult = (await invQuery) as unknown as QueryResult<SupabaseInvoiceRow>;
  const invoices = invResult.data ?? [];
  if (invResult.error) {
    throw invResult.error;
  }
  return invoices.map((inv) => {
    const res = Array.isArray(inv.residents) ? inv.residents[0] : inv.residents;
    const fn = res?.first_name?.trim() ?? "";
    const ln = res?.last_name?.trim() ?? "";
    const residentName = `${fn} ${ln}`.trim() || "Resident";
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      residentName,
      payerType: mapDbPayerTypeToUi(inv.payer_type),
      status: mapDbInvoiceStatusToUi(inv.status),
      amountDueCents: Math.max(0, inv.balance_due),
      dueDate: formatDueDisplay(inv.due_date, inv.status),
      updatedAt: formatUpdatedAt(inv.updated_at),
    };
  });
}

export function mapDbPayerTypeToUi(value: string | null): PayerTypeUi {
  if (value === "medicaid_oss") return "medicaid";
  if (value === "ltc_insurance" || value === "va_aid_attendance") return "ltc_insurance";
  if (value === "private_pay") return "private_pay";
  return "private_pay";
}

export function mapDbInvoiceStatusToUi(value: string): InvoiceStatusUi {
  if (
    value === "draft" ||
    value === "sent" ||
    value === "paid" ||
    value === "partial" ||
    value === "overdue" ||
    value === "void" ||
    value === "written_off"
  ) {
    return value;
  }
  return "draft";
}

function formatDueDisplay(dueDate: string, status: string): string {
  if (status === "paid") return "Paid";
  const parsed = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatUpdatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
