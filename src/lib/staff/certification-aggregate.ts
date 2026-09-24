import { canClaimAllClear } from "@/lib/metrics/metric-state";
import type { CertificationPolicy } from "@/lib/staff/certification-policy";

/**
 * One rule for a staff member's certifications, shared by the roster
 * (`load-staff.ts`), the staff profile header and the staffing console.
 *
 * What a person must hold comes from the configured requirements for their
 * job role (COL-709). Nobody is judged against a requirement nobody set:
 *   - no requirement recorded for the scope   → `not_set_up`
 *   - the role needs nothing                  → `not_required`
 *   - a required type has no certification    → `missing_required`
 * Zero certifications on file is never "current" (COL-649).
 */
export type CertificationStatus =
  | "current"
  | "expiring_soon"
  | "expired"
  | "missing_required"
  | "not_required"
  | "not_set_up";

export type CertificationRecord = {
  certification_type?: string | null;
  status: string;
  expiration_date: string | null;
};

export type CertificationEvaluation = {
  status: CertificationStatus;
  missingTypes: string[];
  expiredTypes: string[];
  expiringTypes: string[];
};

type CertState = "valid" | "expiring" | "expired";

function certState(cert: CertificationRecord, now: Date, soon: Date | null): CertState {
  if (cert.status === "expired" || cert.status === "revoked") return "expired";
  if (cert.expiration_date) {
    const exp = new Date(`${cert.expiration_date}T23:59:59`);
    if (exp < now) return "expired";
    if (soon && exp <= soon) return "expiring";
  }
  if (cert.status === "pending_renewal") return "expiring";
  return "valid";
}

const RANK: Record<CertState, number> = { valid: 2, expiring: 1, expired: 0 };

function expiringWindowEnd(now: Date, days: number | null): Date | null {
  if (days === null) return null;
  const soon = new Date(now);
  soon.setDate(soon.getDate() + days);
  return soon;
}

export function evaluateStaffCertifications(input: {
  staffRole: string;
  certs: CertificationRecord[];
  policy: CertificationPolicy;
  now?: Date;
}): CertificationEvaluation {
  const now = input.now ?? new Date();
  const soon = expiringWindowEnd(now, input.policy.expiringSoonDays);

  if (!input.policy.configured) {
    // Nothing is required yet, but a certification on file that has lapsed is
    // still a fact worth showing.
    const states = input.certs.map((c) => certState(c, now, soon));
    const status: CertificationStatus = states.includes("expired")
      ? "expired"
      : states.includes("expiring")
        ? "expiring_soon"
        : "not_set_up";
    return { status, missingTypes: [], expiredTypes: [], expiringTypes: [] };
  }

  const required = input.policy.requiredTypesByRole.get(input.staffRole);
  if (!required || required.size === 0) {
    return { status: "not_required", missingTypes: [], expiredTypes: [], expiringTypes: [] };
  }

  const missingTypes: string[] = [];
  const expiredTypes: string[] = [];
  const expiringTypes: string[] = [];
  for (const type of [...required].sort()) {
    const held = input.certs.filter((c) => c.certification_type === type);
    if (held.length === 0) {
      missingTypes.push(type);
      continue;
    }
    const best = held
      .map((c) => certState(c, now, soon))
      .sort((a, b) => RANK[b] - RANK[a])[0]!;
    if (best === "expired") expiredTypes.push(type);
    else if (best === "expiring") expiringTypes.push(type);
  }

  const issues = missingTypes.length + expiredTypes.length + expiringTypes.length;
  const status: CertificationStatus =
    expiredTypes.length > 0
      ? "expired"
      : missingTypes.length > 0
        ? "missing_required"
        : expiringTypes.length > 0
          ? "expiring_soon"
          : canClaimAllClear({ scopeSize: required.size, issueCount: issues })
            ? "current"
            : "not_set_up";
  return { status, missingTypes, expiredTypes, expiringTypes };
}

/** Needs someone to act: a required certification is missing, expired or about to expire. */
export function certificationNeedsAttention(status: CertificationStatus): boolean {
  return status === "expired" || status === "missing_required" || status === "expiring_soon";
}

export const CERT_STATUS_LABEL: Record<CertificationStatus, string> = {
  current: "Certs OK",
  expiring_soon: "Expiring soon",
  expired: "Cert issue",
  missing_required: "Required cert missing",
  not_required: "Not required",
  not_set_up: "Requirements not set up",
};

/** Timeline of one certification on the certifications list, using the configured window. */
export type CertificationTimeline = "current" | "expiring_soon" | "expired";

export function certificationTimeline(
  cert: CertificationRecord,
  expiringSoonDays: number | null,
  now: Date = new Date(),
): CertificationTimeline {
  const state = certState(cert, now, expiringWindowEnd(now, expiringSoonDays));
  return state === "expired" ? "expired" : state === "expiring" ? "expiring_soon" : "current";
}
