import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FamilyInvoiceRow = {
  id: string;
  invoiceNumber: string;
  residentId: string;
  residentName: string;
  invoiceDate: string;
  dueDate: string;
  periodLabel: string;
  total: number;
  balanceDue: number;
  status: Database["public"]["Enums"]["invoice_status"];
  statusLabel: string;
};

export type FamilyBillingContext = {
  invoices: FamilyInvoiceRow[];
  /** Sum of balance due on invoices that are not fully settled (excludes paid / void / written_off). */
  totalBalanceDue: number;
  lastPaymentAmount: number | null;
  lastPaymentDateLabel: string | null;
  hasOverdue: boolean;
};

function residentDisplayName(row: {
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    row.preferred_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    "Your loved one"
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatMediumDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function periodLabel(start: string, end: string): string {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${start} – ${end}`;
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(a);
  }
  return `${formatMediumDate(start)} – ${formatMediumDate(end)}`;
}

function statusLabel(s: Database["public"]["Enums"]["invoice_status"]): string {
  return s.replace(/_/g, " ");
}

function isOpenBalance(st: Database["public"]["Enums"]["invoice_status"]): boolean {
  return st !== "paid" && st !== "void" && st !== "written_off";
}

/**
 * Invoices and payment summary visible to the signed-in family user (RLS + can_view_financial on links).
 */
export async function fetchFamilyBillingContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; data: FamilyBillingContext } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view billing." };

  const [invQ, payQ] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, resident_id, invoice_number, invoice_date, due_date, period_start, period_end, total, balance_due, status",
      )
      .order("invoice_date", { ascending: false })
      .limit(60),
    supabase
      .from("payments")
      .select("amount, payment_date")
      .order("payment_date", { ascending: false })
      .limit(1),
  ]);

  if (invQ.error) return { ok: false, error: invQ.error.message };
  if (payQ.error) return { ok: false, error: payQ.error.message };

  const rawInv = (invQ.data ?? []) as Array<{
    id: string;
    resident_id: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    period_start: string;
    period_end: string;
    total: number;
    balance_due: number;
    status: Database["public"]["Enums"]["invoice_status"];
  }>;

  const resIds = [...new Set(rawInv.map((i) => i.resident_id))];
  const nameById = new Map<string, string>();
  if (resIds.length > 0) {
    const resQ = await supabase
      .from("residents")
      .select("id, first_name, last_name, preferred_name")
      .in("id", resIds)
      .is("deleted_at", null);
    if (resQ.error) return { ok: false, error: resQ.error.message };
    for (const r of resQ.data ?? []) {
      const row = r as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      };
      nameById.set(row.id, residentDisplayName(row));
    }
  }

  const invoices: FamilyInvoiceRow[] = rawInv.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoice_number,
    residentId: i.resident_id,
    residentName: nameById.get(i.resident_id) ?? "Your loved one",
    invoiceDate: i.invoice_date,
    dueDate: i.due_date,
    periodLabel: periodLabel(i.period_start, i.period_end),
    total: i.total,
    balanceDue: i.balance_due,
    status: i.status,
    statusLabel: statusLabel(i.status),
  }));

  let totalBalanceDue = 0;
  let hasOverdue = false;
  for (const i of rawInv) {
    if (isOpenBalance(i.status)) {
      totalBalanceDue += Number(i.balance_due) || 0;
    }
    if (i.status === "overdue") hasOverdue = true;
  }

  const lastPay = payQ.data?.[0] as { amount: number; payment_date: string } | undefined;
  const lastPaymentAmount = lastPay != null ? lastPay.amount : null;
  const lastPaymentDateLabel =
    lastPay != null ? formatMediumDate(lastPay.payment_date.split("T")[0] ?? lastPay.payment_date) : null;

  return {
    ok: true,
    data: {
      invoices,
      totalBalanceDue,
      lastPaymentAmount,
      lastPaymentDateLabel,
      hasOverdue,
    },
  };
}

export function formatUsd(n: number): string {
  return formatMoney(n);
}

export type FamilyPaymentRow = {
  id: string;
  residentName: string;
  amount: number;
  dateLabel: string;
  methodLabel: string;
  reference: string;
};

function paymentMethodLabel(m: Database["public"]["Enums"]["payment_method"]): string {
  return m.replace(/_/g, " ");
}

/**
 * Payment history visible to the signed-in family user (RLS).
 */
export async function fetchFamilyPaymentsList(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; rows: FamilyPaymentRow[] } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view payments." };

  const payQ = await supabase
    .from("payments")
    .select("id, resident_id, amount, payment_date, payment_method, reference_number")
    .order("payment_date", { ascending: false })
    .limit(50);

  if (payQ.error) return { ok: false, error: payQ.error.message };

  const raw = (payQ.data ?? []) as Array<{
    id: string;
    resident_id: string;
    amount: number;
    payment_date: string;
    payment_method: Database["public"]["Enums"]["payment_method"];
    reference_number: string | null;
  }>;

  const resIds = [...new Set(raw.map((p) => p.resident_id))];
  const nameById = new Map<string, string>();
  if (resIds.length > 0) {
    const resQ = await supabase
      .from("residents")
      .select("id, first_name, last_name, preferred_name")
      .in("id", resIds)
      .is("deleted_at", null);
    if (resQ.error) return { ok: false, error: resQ.error.message };
    for (const r of resQ.data ?? []) {
      const row = r as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      };
      nameById.set(row.id, residentDisplayName(row));
    }
  }

  const rows: FamilyPaymentRow[] = raw.map((p) => {
    const datePart = p.payment_date.includes("T") ? p.payment_date.split("T")[0]! : p.payment_date;
    return {
      id: p.id,
      residentName: nameById.get(p.resident_id) ?? "Your loved one",
      amount: p.amount,
      dateLabel: formatMediumDate(datePart),
      methodLabel: paymentMethodLabel(p.payment_method),
      reference: p.reference_number?.trim() || "—",
    };
  });

  return { ok: true, rows };
}

export function invoiceStatusBadgeClass(status: Database["public"]["Enums"]["invoice_status"]): string {
  switch (status) {
    case "paid":
      return "border-emerald-300 bg-emerald-100 text-emerald-800";
    case "overdue":
      return "border-rose-300 bg-rose-100 text-rose-800";
    case "void":
    case "written_off":
      return "border-stone-300 bg-stone-100 text-stone-600";
    case "partial":
      return "border-amber-300 bg-amber-100 text-amber-800";
    default:
      return "border-amber-300 bg-amber-100 text-amber-800";
  }
}
