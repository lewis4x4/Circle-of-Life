/**
 * Opt-in demo UI (mock charts, hydration rows, sample KPIs).
 * Production/UAT should leave `NEXT_PUBLIC_DEMO_MODE` unset or not `"true"` so empty states reflect real data gaps.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
