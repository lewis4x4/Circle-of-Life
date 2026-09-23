import { metricNoData, metricValue, type MetricState } from "@/lib/metrics/metric-state";
import type { CertificationStatus } from "@/lib/staff/load-staff";

/**
 * Roster "Cert attention" tile (COL-649).
 *
 * The tile counted every row whose status was not "current", so a staff member
 * with no certification on file ("not_verified") counted as needing attention
 * the same as one with an expired licence. With nobody's credentials recorded
 * the tile read "Cert attention 56" — the whole roster, owners included — which
 * says nothing about who actually needs a renewal. Attention is now expired or
 * expiring certifications; "no certification on file" is named separately as a
 * gap in the records.
 */
export type RosterCertSummary = {
  attention: MetricState<number>;
  /** Staff with no certification on file at all. */
  notOnFile: number;
  description: string | null;
};

export function summarizeRosterCerts(rows: ReadonlyArray<{ certifications: CertificationStatus }>): RosterCertSummary {
  const notOnFile = rows.filter((row) => row.certifications === "not_verified").length;
  const attention = rows.filter(
    (row) => row.certifications === "expired" || row.certifications === "expiring_soon",
  ).length;

  if (rows.length === 0) {
    return { attention: metricNoData("No staff"), notOnFile, description: null };
  }
  if (notOnFile === rows.length) {
    return {
      attention: metricNoData("No certs on file"),
      notOnFile,
      description: `None of the ${rows.length} staff shown has a certification on file.`,
    };
  }
  return {
    attention: metricValue(attention),
    notOnFile,
    description:
      notOnFile > 0
        ? `Expired or expiring. ${notOnFile} more ${notOnFile === 1 ? "has" : "have"} no certification on file.`
        : "Expired or expiring.",
  };
}
