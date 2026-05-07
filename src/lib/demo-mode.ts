/**
 * Opt-in demo UI (mock charts, hydration rows, sample KPIs).
 * Production/UAT should leave `NEXT_PUBLIC_DEMO_MODE` unset or not `"true"` so empty states reflect real data gaps.
 * Browser storage may only disable an env-enabled demo session; it must not
 * enable demo mode on an otherwise live/UAT build.
 */
export const DEMO_MODE_STORAGE_KEY = "haven-demo-mode-enabled";

export function isDemoModeEnabledByEnv(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export function isDemoMode(): boolean {
  if (!isDemoModeEnabledByEnv()) return false;

  // SSR / non-DOM: never imply demo on — client components should use
  // `useClientDemoMode` for UI that depends on localStorage.
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY);
    if (stored === "false") return false;
  } catch {
    // fall through to env-default
  }
  return true;
}
