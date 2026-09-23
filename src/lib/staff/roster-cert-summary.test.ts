import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";
import type { CertificationStatus } from "@/lib/staff/load-staff";

import { summarizeRosterCerts } from "./roster-cert-summary";

const rows = (...statuses: CertificationStatus[]) => statuses.map((certifications) => ({ certifications }));

describe("summarizeRosterCerts (COL-649)", () => {
  it("does not report the whole roster as cert attention when nobody has certifications on file", () => {
    const summary = summarizeRosterCerts(rows(...Array<CertificationStatus>(56).fill("not_verified")));
    expect(formatMetric(summary.attention)).toBe("No certs on file");
    expect(summary.notOnFile).toBe(56);
    expect(summary.description).toContain("56");
  });

  it("counts only expired and expiring certifications as attention, and names the gap separately", () => {
    const summary = summarizeRosterCerts(rows("expired", "expiring_soon", "current", "not_verified", "not_verified"));
    expect(summary.attention).toEqual({ status: "value", value: 2 });
    expect(summary.description).toBe("Expired or expiring. 2 more have no certification on file.");
  });

  it("keeps a real zero when everyone's certifications are current", () => {
    const summary = summarizeRosterCerts(rows("current", "current"));
    expect(summary.attention).toEqual({ status: "value", value: 0 });
  });

  it("has no figure with no staff", () => {
    expect(summarizeRosterCerts([]).attention.status).toBe("no_data");
  });
});
