/** Display integer cents as USD string. */
export function formatCents(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}

/** Parse user input like "12.34" or "1234" into integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const t = input.trim().replace(/[$,]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
