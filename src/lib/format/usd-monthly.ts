/**
 * Currency display for monthly facility rates — thousands separator;
 * omit cents when amount is whole dollars.
 */

export function formatUsdMonthlyFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  const wholeDollars = Number.isInteger(dollars) && cents % 100 === 0;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: wholeDollars ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
  return `${formatted} / mo`;
}

export function formatUsdCurrencyFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  const wholeDollars = Number.isInteger(dollars) && cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: wholeDollars ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}
