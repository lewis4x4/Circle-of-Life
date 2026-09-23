/**
 * Forecast tile copy (COL-650). A forecast figure with no underlying records is
 * "no data", not zero: DSO with nothing sent is undefined, a run-rate with no
 * approved time is unknown, and a capex horizon with no replacement dates is an
 * absent plan. These helpers return the words for those cases so the page never
 * prints 0.0d, 0.0% or $0.00 in place of a gap.
 */
import { formatCents } from "@/lib/finance/format-cents";

export const FORECAST_NOTHING_SENT_COPY = "No invoices sent in the last 90 days";

export function forecastDaysValue(days: number | null): string {
  return days == null ? "Not measurable" : `${days.toFixed(1)}d`;
}

export function forecastPctValue(pct: number | null): string {
  return pct == null ? "Not measurable" : `${pct.toFixed(1)}%`;
}

/** Short cell text for per-facility rows. */
export function forecastDaysCell(days: number | null): string {
  return days == null ? "No billing" : `${days.toFixed(1)}d`;
}

export function forecastPctCell(pct: number | null): string {
  return pct == null ? "No billing" : `${pct.toFixed(1)}%`;
}

export function forecastBilledValue(cents: number, sentCount: number): string {
  return sentCount === 0 ? "Nothing sent" : formatCents(cents);
}

export function forecastCollectedValue(cents: number, paymentCount: number): string {
  return paymentCount === 0 ? "No payments recorded" : formatCents(cents);
}

export function forecastRunRateValue(cents: number, recordCount: number, emptyCopy: string): string {
  return recordCount === 0 ? emptyCopy : formatCents(cents);
}

export function forecastDsoDetail(projected: number | null, sentCount: number): string {
  if (sentCount === 0 || projected == null) return FORECAST_NOTHING_SENT_COPY;
  return `Projected 30d ${forecastDaysValue(projected)}`;
}

/** Neutral tone unless both DSO figures exist; a missing DSO is not "improving". */
export function forecastDsoAccent(current: number | null, projected: number | null): "indigo" | "emerald" | "amber" {
  if (current == null || projected == null) return "indigo";
  return projected > current ? "amber" : "emerald";
}
