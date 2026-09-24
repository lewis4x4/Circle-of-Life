import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";
import type { CertificationStatus } from "@/lib/staff/load-staff";

import { summarizeRosterCerts } from "./roster-cert-summary";

const rows = (setUp: boolean, ...statuses: CertificationStatus[]) =>
  statuses.map((certifications) => ({ certifications, certRequirementsSetUp: setUp }));

describe("summarizeRosterCerts (COL-649, COL-709)", () => {
  it("says requirements are not set up instead of flagging the whole roster", () => {
    const summary = summarizeRosterCerts(rows(false, ...Array<CertificationStatus>(56).fill("not_set_up")));
    expect(formatMetric(summary.attention)).toBe("Requirements not set up");
    expect(summary.attention.status).toBe("not_configured");
    expect(summary.notSetUp).toBe(56);
  });

  it("does not count a lapsed certification when nothing is required yet", () => {
    const summary = summarizeRosterCerts(rows(false, "expired", "not_set_up"));
    expect(summary.attention.status).toBe("not_configured");
  });

  it("counts missing, expired and expiring required certifications, and never roles that need none", () => {
    const summary = summarizeRosterCerts(
      rows(true, "expired", "expiring_soon", "missing_required", "current", "not_required", "not_required"),
    );
    expect(summary.attention).toEqual({ status: "value", value: 3 });
    expect(summary.description).toBe("Required certifications missing, expired or expiring. 2 hold roles that need none.");
  });

  it("names staff at buildings with no requirements set", () => {
    const summary = summarizeRosterCerts([...rows(true, "current"), ...rows(false, "not_set_up")]);
    expect(summary.attention).toEqual({ status: "value", value: 0 });
    expect(summary.description).toContain("1 is at a building with no requirements set.");
  });

  it("has no figure with no staff", () => {
    expect(summarizeRosterCerts([]).attention.status).toBe("no_data");
  });
});
