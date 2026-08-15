/**
 * Human-readable attribution for vault + audit surfaces (Quiet Operator — never leak raw UUIDs to UI).
 */

export const USER_ATTRIBUTION_NO_NAME_COPY = "No name posted";

export type UserAttributionFields = {
  display_name?: string | null;
  /** Haven `user_profiles.full_name` (falls back before email) */
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_LOWER = "unknown";

function pickAttributionField(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === EM_DASH) return null;
  if (trimmed === LEGACY_UNKNOWN || trimmed === LEGACY_UNKNOWN_LOWER) return null;
  return trimmed;
}

export function formatUploadedByProfile(row: UserAttributionFields | null | undefined): string {
  if (!row) return USER_ATTRIBUTION_NO_NAME_COPY;

  const display = pickAttributionField(row.display_name);
  if (display) return display;

  const full = pickAttributionField(row.full_name);
  if (full) return full;

  const email = pickAttributionField(row.email);
  if (email) return email;

  const first = pickAttributionField(row.first_name) ?? "";
  const last = pickAttributionField(row.last_name) ?? "";
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;

  return USER_ATTRIBUTION_NO_NAME_COPY;
}
