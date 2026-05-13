/**
 * Legacy demo UI is disabled for Homewood live onboarding.
 *
 * The app must not hydrate seeded/demo residents, facilities, KPIs, alerts, or
 * rounding rows while Homewood is being converted to real Facility DNA data.
 * Keep this function false unless a future isolated demo environment is built
 * with fixtures that cannot leak into live/UAT routes.
 */
export const DEMO_MODE_STORAGE_KEY = "haven-demo-mode-enabled";

export function isDemoModeEnabledByEnv(): boolean {
  return false;
}

export function isDemoMode(): boolean {
  return false;
}
