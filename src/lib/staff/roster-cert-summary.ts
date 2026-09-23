import {
  metricNoData,
  metricNotConfigured,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";
import { certificationNeedsAttention, type CertificationStatus } from "@/lib/staff/certification-aggregate";

/**
 * Roster "Cert attention" tile (COL-649, COL-709).
 *
 * Attention follows the configured requirements for each job role: a required
 * certification that is missing, expired or expiring. A role that needs none
 * is never counted, so owners and executives are not flagged unless an admin
 * sets a requirement for their role (Brian's ruling, 2026-09-23). Staff at a
 * building with no requirement recorded are not judged at all, and the tile
 * says the requirements are not set up rather than showing a count.
 */
export type RosterCertSummary = {
  attention: MetricState<number>;
  /** Staff at buildings where no certification requirement is recorded. */
  notSetUp: number;
  description: string | null;
};

export const CERT_REQUIREMENTS_NOT_SET_UP = "Requirements not set up";

export function summarizeRosterCerts(
  rows: ReadonlyArray<{ certifications: CertificationStatus; certRequirementsSetUp: boolean }>,
): RosterCertSummary {
  if (rows.length === 0) {
    return { attention: metricNoData("No staff"), notSetUp: 0, description: null };
  }
  const judged = rows.filter((row) => row.certRequirementsSetUp);
  const notSetUp = rows.length - judged.length;
  if (judged.length === 0) {
    return {
      attention: metricNotConfigured(CERT_REQUIREMENTS_NOT_SET_UP),
      notSetUp,
      description: "No job role has a certification requirement yet, so nobody is flagged.",
    };
  }
  const attention = judged.filter((row) => certificationNeedsAttention(row.certifications)).length;
  const notRequired = judged.filter((row) => row.certifications === "not_required").length;
  const parts = ["Required certifications missing, expired or expiring."];
  if (notRequired > 0) {
    parts.push(`${notRequired} ${notRequired === 1 ? "holds a role that needs" : "hold roles that need"} none.`);
  }
  if (notSetUp > 0) {
    parts.push(`${notSetUp} ${notSetUp === 1 ? "is" : "are"} at a building with no requirements set.`);
  }
  return { attention: metricValue(attention), notSetUp, description: parts.join(" ") };
}
