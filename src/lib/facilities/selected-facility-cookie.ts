import { UUID_STRING_RE } from "@/lib/supabase/env";

export const SELECTED_FACILITY_COOKIE = "haven_selected_facility";
const ALL_FACILITIES_COOKIE_VALUE = "all";

export function parseSelectedFacilityCookieValue(value: string | null | undefined): string | null {
  if (!value || value === ALL_FACILITIES_COOKIE_VALUE) return null;
  return UUID_STRING_RE.test(value) ? value : null;
}

export function syncSelectedFacilityCookie(selectedFacilityId: string | null): void {
  if (typeof document === "undefined") return;
  const value = selectedFacilityId ?? ALL_FACILITIES_COOKIE_VALUE;
  document.cookie = `${SELECTED_FACILITY_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
