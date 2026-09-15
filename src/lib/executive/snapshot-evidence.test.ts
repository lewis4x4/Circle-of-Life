import { describe, expect, it } from "vitest";

import {
  billedRevenuePeriodLine,
  facilityTodayIsoDate,
  incidentRateBasis,
  readSnapshotEvidence,
  resolveSnapshotState,
  snapshotFreshnessLine,
} from "./snapshot-evidence";

const RUN = {
  snapshot_date: "2026-09-15",
  computed_at: "2026-09-15T06:00:00.000Z",
  metrics: {
    census: { occupiedResidents: 25, licensedBeds: 60 },
    clinical: { incidentRatePer1kResidentDays: 0 },
    financial: { billedRevenueMtdCents: 0 },
    workforce: { laborCostMtdCents: null },
  },
};

describe("snapshot evidence", () => {
  it("keeps a failed read apart from a missing run", () => {
    expect(resolveSnapshotState({ row: null, errorMessage: "boom", todayIsoDate: "2026-09-15" })).toEqual({
      kind: "unreadable",
      message: "boom",
    });
    expect(resolveSnapshotState({ row: null, errorMessage: null, todayIsoDate: "2026-09-15" })).toEqual({
      kind: "never_recorded",
    });
  });

  it("dates a run and marks an earlier one as past evidence", () => {
    const today = resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" });
    expect(today).toMatchObject({ kind: "recorded", ageDays: 0, stale: false });
    expect(snapshotFreshnessLine(today)).toBe("Portfolio figures recorded 2026-09-15 (today).");

    const older = resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-18" });
    expect(older).toMatchObject({ kind: "recorded", ageDays: 3, stale: true });
    expect(snapshotFreshnessLine(older)).toBe(
      "Portfolio figures recorded 2026-09-15 — 3 days ago. They describe that day, not today.",
    );
  });

  it("never reports an unreadable run as current", () => {
    expect(snapshotFreshnessLine({ kind: "unreadable", message: "boom" })).toContain("age as unknown");
    expect(snapshotFreshnessLine({ kind: "never_recorded" })).toContain("No portfolio figures have been recorded");
  });

  it("reads absent payload keys as absent rather than zero", () => {
    const evidence = readSnapshotEvidence({ snapshot_date: "2026-09-15", computed_at: null, metrics: {} });
    expect(evidence.occupiedResidents).toBeNull();
    expect(evidence.billedRevenueMtdCents).toBeNull();
  });

  it("gives the incident rate a denominator or refuses to present it", () => {
    const usable = incidentRateBasis(resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" }));
    expect(usable.usable).toBe(true);
    expect(usable.residentDays).toBe(750);
    expect(usable.line).toContain("750 resident-days (25 residents × 30 days)");

    const noCensus = incidentRateBasis(
      resolveSnapshotState({
        row: { ...RUN, metrics: { census: { occupiedResidents: 0 } } },
        todayIsoDate: "2026-09-15",
      }),
    );
    expect(noCensus.usable).toBe(false);
    expect(noCensus.line).toContain("no denominator");

    const noRun = incidentRateBasis({ kind: "never_recorded" });
    expect(noRun.usable).toBe(false);
    expect(noRun.residentDays).toBeNull();
  });

  it("ages a run against the facilities' operating day, not the browser's", () => {
    // 2026-09-16T01:00Z is still the evening of the 15th in America/New_York.
    expect(facilityTodayIsoDate(new Date("2026-09-16T01:00:00.000Z"))).toBe("2026-09-15");
    expect(
      resolveSnapshotState({
        row: RUN,
        todayIsoDate: facilityTodayIsoDate(new Date("2026-09-16T01:00:00.000Z")),
      }),
    ).toMatchObject({ ageDays: 0, stale: false });
  });

  it("names the period billed revenue covers", () => {
    expect(billedRevenuePeriodLine(resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" }))).toBe(
      "Invoices dated 2026-09-01 through 2026-09-15.",
    );
    expect(billedRevenuePeriodLine({ kind: "never_recorded" })).toBe(
      "No billing period is recorded with this figure.",
    );
  });
});
