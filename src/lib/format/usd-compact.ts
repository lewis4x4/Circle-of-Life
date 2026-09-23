/**
 * Compact dollar display for projections and chart axes (COL-656).
 *
 * The sign goes before the currency symbol and uses a true minus sign, so a
 * loss reads "−$1.45M" rather than "$-1452K". Pair the value with
 * {@link usdTone} so a negative figure is never painted in a positive colour.
 */

const MINUS = "−";

function trim(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** Whole dollars in, "$950", "$740K", "$1.45M", "−$1.45M" out. Non-finite input renders an em dash. */
export function formatUsdCompact(dollars: number): string {
  if (!Number.isFinite(dollars)) return "—";
  const sign = dollars < 0 ? MINUS : "";
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000, abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export type UsdTone = "success" | "danger" | "default";

/** Loss is danger, gain is success, zero or unknown stays neutral. */
export function usdTone(dollars: number): UsdTone {
  if (!Number.isFinite(dollars) || dollars === 0) return "default";
  return dollars < 0 ? "danger" : "success";
}
