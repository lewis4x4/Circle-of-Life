/**
 * Default licensing authority caption for Assisted Living Facilities by state (US-only for now).
 * Does not mutate DB — UI / API summaries use when `facilities.license_authority` is null.
 */

import { LICENSE_AUTHORITY_NO_AUTHORITY_COPY } from "./license-authority-display-copy";

export function defaultAssistedLivingAuthorityLabel(stateRaw: string | null | undefined): string {
  const st = typeof stateRaw === "string" ? stateRaw.trim().toUpperCase() : "";
  if (st === "FL") return "Florida Agency for Health Care Administration (AHCA)";
  if (!st || st.length !== 2) return LICENSE_AUTHORITY_NO_AUTHORITY_COPY;
  return `State regulatory authority (${st}) — confirm license issuer on file`;
}
