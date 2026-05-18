/**
 * Human-readable attribution for vault + audit surfaces (Quiet Operator — never leak raw UUIDs to UI).
 */

export type UserAttributionFields = {
  display_name?: string | null;
  /** Haven `user_profiles.full_name` (falls back before email) */
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export function formatUploadedByProfile(row: UserAttributionFields | null | undefined): string {
  if (!row) return "Unknown";

  const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (display) return display;

  const full = typeof row.full_name === "string" ? row.full_name.trim() : "";
  if (full) return full;

  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (email) return email;

  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;

  return "Unknown";
}
