import { describe, expect, it } from "vitest";

import type { CertificationPolicy } from "./certification-policy";
import {
  CERT_STATUS_LABEL,
  certificationNeedsAttention,
  certificationTimeline,
  evaluateStaffCertifications,
} from "./certification-aggregate";

const NOW = new Date("2026-09-23T12:00:00");

function policy(required: Record<string, string[]>, expiringSoonDays: number | null = 60): CertificationPolicy {
  return {
    configured: true,
    requiredTypesByRole: new Map(Object.entries(required).map(([role, types]) => [role, new Set(types)])),
    expiringSoonDays,
  };
}
const NOT_SET_UP: CertificationPolicy = { configured: false, requiredTypesByRole: new Map(), expiringSoonDays: 60 };

const cert = (certification_type: string, expiration_date: string | null, status = "active") => ({
  certification_type,
  expiration_date,
  status,
});

describe("evaluateStaffCertifications (COL-709)", () => {
  it("does not flag an owner whose role has no requirement", () => {
    const result = evaluateStaffCertifications({ staffRole: "owner", certs: [], policy: policy({ medication_tech: ["bls_cpr"] }), now: NOW });
    expect(result.status).toBe("not_required");
    expect(certificationNeedsAttention(result.status)).toBe(false);
    expect(CERT_STATUS_LABEL.not_required).toBe("Not required");
  });

  it("names a missing required certification", () => {
    const result = evaluateStaffCertifications({
      staffRole: "medication_tech",
      certs: [cert("bls_cpr", "2027-09-01")],
      policy: policy({ medication_tech: ["bls_cpr", "medication_administration"] }),
      now: NOW,
    });
    expect(result.status).toBe("missing_required");
    expect(result.missingTypes).toEqual(["medication_administration"]);
    expect(certificationNeedsAttention(result.status)).toBe(true);
  });

  it("is current only when every required type is held and valid", () => {
    const result = evaluateStaffCertifications({
      staffRole: "medication_tech",
      certs: [cert("bls_cpr", "2027-09-01"), cert("medication_administration", null)],
      policy: policy({ medication_tech: ["bls_cpr", "medication_administration"] }),
      now: NOW,
    });
    expect(result.status).toBe("current");
  });

  it("uses the newest valid certification of a type, not a lapsed older one", () => {
    const result = evaluateStaffCertifications({
      staffRole: "cna",
      certs: [cert("cna", "2025-01-01"), cert("cna", "2028-01-01")],
      policy: policy({ cna: ["cna"] }),
      now: NOW,
    });
    expect(result.status).toBe("current");
  });

  it("flags an expired required certification before a missing one", () => {
    const result = evaluateStaffCertifications({
      staffRole: "cna",
      certs: [cert("cna", "2026-09-01")],
      policy: policy({ cna: ["cna", "bls_cpr"] }),
      now: NOW,
    });
    expect(result.status).toBe("expired");
    expect(result.expiredTypes).toEqual(["cna"]);
    expect(result.missingTypes).toEqual(["bls_cpr"]);
  });

  it("follows the configured expiring-soon window (COL-710)", () => {
    const certs = [cert("cna", "2026-11-10")]; // 48 days out
    expect(evaluateStaffCertifications({ staffRole: "cna", certs, policy: policy({ cna: ["cna"] }, 60), now: NOW }).status).toBe(
      "expiring_soon",
    );
    expect(evaluateStaffCertifications({ staffRole: "cna", certs, policy: policy({ cna: ["cna"] }, 30), now: NOW }).status).toBe(
      "current",
    );
  });

  it("with no requirements recorded, judges nobody and says so", () => {
    const result = evaluateStaffCertifications({ staffRole: "owner", certs: [], policy: NOT_SET_UP, now: NOW });
    expect(result.status).toBe("not_set_up");
    expect(CERT_STATUS_LABEL.not_set_up).toBe("Requirements not set up");
  });

  it("with no requirements recorded, still shows a lapsed certification on file", () => {
    expect(
      evaluateStaffCertifications({ staffRole: "cna", certs: [cert("cna", "2026-09-01")], policy: NOT_SET_UP, now: NOW }).status,
    ).toBe("expired");
  });
});

describe("certificationTimeline", () => {
  it("uses the configured window", () => {
    expect(certificationTimeline(cert("cna", "2026-11-10"), 60, NOW)).toBe("expiring_soon");
    expect(certificationTimeline(cert("cna", "2026-11-10"), 30, NOW)).toBe("current");
    expect(certificationTimeline(cert("cna", "2026-09-01"), 30, NOW)).toBe("expired");
    expect(certificationTimeline(cert("cna", null, "pending_renewal"), null, NOW)).toBe("expiring_soon");
  });
});
