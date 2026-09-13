/** Display integer cents as USD string. */
export function formatCents(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}

/** Parse user input like "12.34" or "1234" into integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const match = /^([+-]?)\$?(?:(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/.exec(input.trim());
  if (!match) return null;
  const whole = BigInt((match[2] ?? "0").replaceAll(",", ""));
  const fraction = BigInt((match[3] ?? match[4] ?? "").padEnd(2, "0"));
  const magnitude = whole * BigInt(100) + fraction;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] === "-" ? -magnitude : magnitude);
}
