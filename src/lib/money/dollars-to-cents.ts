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
