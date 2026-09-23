/**
 * Parse user-entered currency (dollars) to integer cents for DB columns.
 * Strips `$` and `,`; returns null if empty or invalid.
 */
export function dollarsToCents(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number.parseFloat(t.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function dollarsToCentsOrZero(raw: string): number {
  return dollarsToCents(raw) ?? 0;
}

/** At least one cent (e.g. required base rate fields). */
export function requiredPositiveCents(raw: string): number | null {
  const c = dollarsToCents(raw);
  if (c === null || c < 1) return null;
  return c;
}

/** Integer cents from the database as the dollars text an input shows ("4440.00"). */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}
