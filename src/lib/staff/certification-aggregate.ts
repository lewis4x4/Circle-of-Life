import { canClaimAllClear } from "@/lib/metrics/metric-state";

/**
 * Header summary for one staff member's certifications.
 * `none_on_file` is not "current": zero certifications on file is a gap to
 * look at, never a green "Certs OK" (COL-649).
 */
export type CertificationStatus = "current" | "expiring_soon" | "expired" | "none_on_file";

export const CERT_EXPIRING_SOON_DAYS = 60;

export function aggregateCertStatus(
  certs: Array<{ status: string; expiration_date: string | null }>,
  now: Date = new Date(),
): CertificationStatus {
  const soon = new Date(now);
  soon.setDate(soon.getDate() + CERT_EXPIRING_SOON_DAYS);
  let expiring = 0;
  for (const c of certs) {
    if (c.status === "expired" || c.status === "revoked") {
      return "expired";
    }
    if (c.expiration_date) {
      const exp = new Date(`${c.expiration_date}T23:59:59`);
      if (exp < now) return "expired";
      if (exp <= soon) expiring += 1;
    }
    if (c.status === "pending_renewal") {
      expiring += 1;
    }
  }
  if (expiring > 0) return "expiring_soon";
  return canClaimAllClear({ scopeSize: certs.length, issueCount: expiring }) ? "current" : "none_on_file";
}

export const CERT_STATUS_LABEL: Record<CertificationStatus, string> = {
  current: "Certs OK",
  expiring_soon: "Expiring soon",
  expired: "Cert issue",
  none_on_file: "No certs on file",
};
