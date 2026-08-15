/** Quiet Operator copy when integer cents are unset — never fabricates an amount. */
export const FORMAT_USD_NO_AMOUNT_POSTED_COPY = "No amount posted";

export function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents == null) return FORMAT_USD_NO_AMOUNT_POSTED_COPY;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
