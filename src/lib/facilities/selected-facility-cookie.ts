import { UUID_STRING_RE } from "@/lib/supabase/env";

export const SELECTED_FACILITY_COOKIE = "haven_selected_facility";
const ALL_FACILITIES_COOKIE_VALUE = "all";

export function parseSelectedFacilityCookieValue(value: string | null | undefined): string | null {
  if (!value || value === ALL_FACILITIES_COOKIE_VALUE) return null;
  return UUID_STRING_RE.test(value) ? value : null;
}

/** The facility the server will render for on the next request, as the browser currently holds it. */
export function readSelectedFacilityCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SELECTED_FACILITY_COOKIE}=`));
  if (!match) return null;
  let raw = match.slice(SELECTED_FACILITY_COOKIE.length + 1);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return parseSelectedFacilityCookieValue(raw);
}

/**
 * Write the facility scope cookie the server renders from.
 *
 * Returns `true` when the scope the server would use actually changed — the
 * caller should `router.refresh()` so server-rendered pages stop showing the
 * previous facility under the new selector label. Returns `false` when the
 * cookie already named this scope (a missing cookie and "all" are the same
 * scope), so a caller can refresh on change without ever looping.
 */
export function syncSelectedFacilityCookie(selectedFacilityId: string | null): boolean {
  if (typeof document === "undefined") return false;
  const changed = readSelectedFacilityCookie() !== selectedFacilityId;
  const value = selectedFacilityId ?? ALL_FACILITIES_COOKIE_VALUE;
  document.cookie = `${SELECTED_FACILITY_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return changed;
}
