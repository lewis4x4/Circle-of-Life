import { format } from "date-fns";

/** Posted monthly rent: first full cycle aligns to the first of the month on/after effective (pro‑rata out of scope). */
export function labelFirstMonthlyBillingCycle(ymd: string): string {
  const parts = ymd.split("-").map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "—";
  const [y, m, d] = parts;
  if (d === 1) {
    return format(new Date(Date.UTC(y, m - 1, 1, 12, 0, 0)), "MMM d, yyyy");
  }
  return format(new Date(Date.UTC(y, m, 1, 12, 0, 0)), "MMM d, yyyy");
}
