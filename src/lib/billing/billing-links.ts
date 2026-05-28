/**
 * Shared builders for billing deep-links that prefill the payment and
 * collection-activity forms. Keep these in one place so the URL contract
 * (param names) stays in sync across every surface that links into the forms
 * (AR aging, invoice ledger, etc.). The destination forms reconcile the
 * prefilled ids against their own scope before trusting them.
 */

export function collectionActivityHref(residentId: string, invoiceId?: string): string {
  const params = new URLSearchParams({ residentId });
  if (invoiceId) params.set("invoiceId", invoiceId);
  return `/admin/billing/collections/new?${params.toString()}`;
}

export function paymentHref(
  residentId: string,
  invoiceId?: string,
  amountCents?: number,
): string {
  const params = new URLSearchParams({ residentId });
  if (invoiceId) params.set("invoiceId", invoiceId);
  if (amountCents != null && amountCents > 0) {
    params.set("amount", (amountCents / 100).toFixed(2));
  }
  return `/admin/billing/payments/new?${params.toString()}`;
}
