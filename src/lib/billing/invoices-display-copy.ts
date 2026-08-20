/**
 * Quiet Operator copy for invoice list display (`load-invoices` updated-at column).
 * Unparseable updated-at timestamps name the gap — never fabricate dates.
 */

import { UUID_STRING_RE } from "@/lib/supabase/env";

export const INVOICE_NO_UPDATED_AT_COPY = "No date posted";
export const INVOICE_NUMBER_MISSING_COPY = "Invoice number not posted";

/** Persist RPC keys: `{facilityCode8}-{YYYY-MM}-{residentUuid}`. */
const INTERNAL_INVOICE_NUMBER_RE =
  /^[0-9A-F]{8}-\d{4}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatBillingPeriodYm(ym: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(parsed);
}

function formatInvoiceDateMonthYear(invoiceDateIso: string | undefined): string | null {
  if (!invoiceDateIso) return null;
  const ym = invoiceDateIso.slice(0, 7);
  return formatBillingPeriodYm(ym);
}

function invoiceIdShortSuffix(invoiceId: string | undefined): string {
  const normalized = invoiceId?.replace(/-/g, "").trim() ?? "";
  if (normalized.length < 4) return "????";
  return normalized.slice(-4).toLowerCase();
}

function formatInternalInvoiceLabel(opts: {
  invoiceDateIso?: string;
  invoiceId?: string;
  periodYm?: string;
}): string {
  const periodLabel =
    (opts.periodYm ? formatBillingPeriodYm(opts.periodYm) : null) ??
    formatInvoiceDateMonthYear(opts.invoiceDateIso);
  const suffix = invoiceIdShortSuffix(opts.invoiceId);
  if (periodLabel) return `Invoice ${periodLabel} · …${suffix}`;
  return `Invoice · …${suffix}`;
}

/** Operator-facing invoice number for billing ledgers — never leak internal persist keys. */
export function formatInvoiceNumberForDisplay(
  invoiceNumber: string,
  opts?: { invoiceDateIso?: string; invoiceId?: string },
): string {
  const trimmed = invoiceNumber.trim();
  if (!trimmed || trimmed === "—") return INVOICE_NUMBER_MISSING_COPY;

  if (UUID_STRING_RE.test(trimmed)) {
    return formatInternalInvoiceLabel(opts ?? {});
  }

  const internalMatch = INTERNAL_INVOICE_NUMBER_RE.exec(trimmed);
  if (internalMatch) {
    const periodYm = trimmed.slice(9, 16);
    return formatInternalInvoiceLabel({ ...opts, periodYm });
  }

  return trimmed;
}

/** Billing ledger column header — trainees should know what they are scanning. */
export const BILLING_LEDGER_INVOICE_COLUMN_LABEL = "Invoice";

/** Invoice `updated_at` — posted ISO timestamp formatted, or explicit gap copy. */
export function formatUpdatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return INVOICE_NO_UPDATED_AT_COPY;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
