import {
  certificationTimeline,
  evaluateStaffCertifications,
  type CertificationEvaluation,
} from "@/lib/staff/certification-aggregate";
import { certificationPolicyResolver, type CertificationRules } from "@/lib/staff/certification-policy";

/**
 * Certification requirements applied across a set of staff (COL-709): what the
 * staffing console counts and which expired certifications it lists.
 */
export type ScopeStaff = { id: string; staff_role: string; facility_id: string | null };
export type ScopeCert = {
  id: string;
  staff_id: string;
  certification_type: string | null;
  status: string;
  expiration_date: string | null;
};

export type CertificationScopeSummary = {
  /** At least one staff member in scope works at a building with requirements recorded. */
  requirementsSetUp: boolean;
  /** Staff whose building has requirements recorded. */
  staffJudged: number;
  /** Required certifications checked (sum over judged staff of their role's required types). */
  requiredChecks: number;
  /** Required certification types held only as expired certifications. */
  expiredRequired: number;
  /** Staff missing at least one required certification type. */
  staffMissingRequired: number;
  /** The expired certifications behind `expiredRequired`, for the warnings list. */
  expiredRequiredCertIds: string[];
  /** Expired certifications on file whatever the requirements; named when nothing is set up. */
  expiredOnFile: number;
  evaluations: Map<string, CertificationEvaluation>;
};

export function summarizeCertificationScope(input: {
  staff: ScopeStaff[];
  certs: ScopeCert[];
  rules: CertificationRules;
  now?: Date;
}): CertificationScopeSummary {
  const now = input.now ?? new Date();
  const policyFor = certificationPolicyResolver(input.rules, now);
  const certsByStaff = new Map<string, ScopeCert[]>();
  for (const cert of input.certs) {
    const list = certsByStaff.get(cert.staff_id) ?? [];
    list.push(cert);
    certsByStaff.set(cert.staff_id, list);
  }

  let staffJudged = 0;
  let requiredChecks = 0;
  let expiredRequired = 0;
  let staffMissingRequired = 0;
  const expiredRequiredCertIds: string[] = [];
  const evaluations = new Map<string, CertificationEvaluation>();

  for (const person of input.staff) {
    const policy = policyFor(person.facility_id);
    const certs = certsByStaff.get(person.id) ?? [];
    const evaluation = evaluateStaffCertifications({ staffRole: person.staff_role, certs, policy, now });
    evaluations.set(person.id, evaluation);
    if (!policy.configured) continue;
    staffJudged += 1;
    requiredChecks += policy.requiredTypesByRole.get(person.staff_role)?.size ?? 0;
    expiredRequired += evaluation.expiredTypes.length;
    if (evaluation.missingTypes.length > 0) staffMissingRequired += 1;
    for (const cert of certs) {
      if (cert.certification_type && evaluation.expiredTypes.includes(cert.certification_type)) {
        expiredRequiredCertIds.push(cert.id);
      }
    }
  }

  const expiredOnFile = input.certs.filter((c) => certificationTimeline(c, null, now) === "expired").length;

  return {
    requirementsSetUp: staffJudged > 0,
    staffJudged,
    requiredChecks,
    expiredRequired,
    staffMissingRequired,
    expiredRequiredCertIds,
    expiredOnFile,
    evaluations,
  };
}
