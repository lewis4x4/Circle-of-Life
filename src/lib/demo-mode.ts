/**
 * Opt-in demo UI (mock charts, hydration rows, sample KPIs).
 * Production/UAT should leave `NEXT_PUBLIC_DEMO_MODE` unset or not `"true"` so empty states reflect real data gaps.
 */
export const DEMO_MODE_STORAGE_KEY = "haven-demo-mode-enabled";

export function isDemoMode(): boolean {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {
      // fall back to env
    }
  }
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
