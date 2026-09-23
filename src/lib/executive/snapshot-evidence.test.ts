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

  it("calls the resident-day denominator an estimate, because it projects one day's census", () => {
    const basis = incidentRateBasis(resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" }));

    expect(basis.estimated).toBe(true);
    expect(basis.line).toContain("Estimated");
    // The arithmetic and its limit travel together: a reader must not take
    // 750 resident-days for exposure that was actually measured.
    expect(basis.detail).toContain("750 resident-days is 25 residents in census on 2026-09-15 × 30 days");
    expect(basis.detail).toContain("Daily census across the window is not recorded");

    // Nothing to project from means nothing to estimate.
    const noDenominator = incidentRateBasis({ kind: "never_recorded" });
    expect(noDenominator.estimated).toBe(false);
  });

  it("adds up the recorded days and projects only the rest, while any day is unrecorded", () => {
    const state = resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" });
    const basis = incidentRateBasis(state, {
      windowDays: 30,
      measuredDays: 10,
      residentDays: 320,
      startDate: "2026-08-17",
      endDate: "2026-09-15",
    });

    // 320 counted over ten days, plus 25 × the twenty days nobody recorded.
    expect(basis.residentDays).toBe(820);
    expect(basis.usable).toBe(true);
    expect(basis.estimated).toBe(true);
    expect(basis.line).toContain("Estimated");
    expect(basis.measuredDays).toBe(10);
    expect(basis.detail).toContain("320 counted from the daily census on 10 of the 30 days");
    expect(basis.detail).toContain("500 projected from 25 residents in census on 2026-09-15");
    expect(basis.detail).toContain("20 days no census is recorded for");
  });

  it("drops Estimated only once every day in the window was recorded", () => {
    const state = resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" });

    // One day short is still an estimate, however close it is.
    const nearly = incidentRateBasis(state, {
      windowDays: 30,
      measuredDays: 29,
      residentDays: 928,
      startDate: "2026-08-17",
      endDate: "2026-09-15",
    });
    expect(nearly.estimated).toBe(true);
    expect(nearly.line).toContain("Estimated");

    const measured = incidentRateBasis(state, {
      windowDays: 30,
      measuredDays: 30,
      residentDays: 960,
      startDate: "2026-08-17",
      endDate: "2026-09-15",
    });
    expect(measured.estimated).toBe(false);
    expect(measured.usable).toBe(true);
    // The counted total stands on its own; the run's one-day census is not
    // mixed into it, so 960 is not 750 adjusted.
    expect(measured.residentDays).toBe(960);
    expect(measured.line).not.toContain("Estimated");
    expect(measured.detail).toContain("added up across all 30 days from 2026-08-17 through 2026-09-15");
    expect(measured.detail).toContain("No day in the window is projected");
  });

  it("uses the counted denominator even when the run recorded no census of its own", () => {
    const state = resolveSnapshotState({
      row: { ...RUN, metrics: { ...RUN.metrics, census: {} } },
      todayIsoDate: "2026-09-15",
    });

    expect(incidentRateBasis(state).usable).toBe(false);
    expect(
      incidentRateBasis(state, {
        windowDays: 30,
        measuredDays: 30,
        residentDays: 960,
        startDate: "2026-08-17",
        endDate: "2026-09-15",
      }),
    ).toMatchObject({ usable: true, estimated: false, residentDays: 960 });
  });

  it("keeps a counted zero apart from a missing denominator", () => {
    const state = resolveSnapshotState({ row: RUN, todayIsoDate: "2026-09-15" });
    const emptyWindow = incidentRateBasis(state, {
      windowDays: 30,
      measuredDays: 30,
      residentDays: 0,
      startDate: "2026-08-17",
      endDate: "2026-09-15",
    });

    expect(emptyWindow.usable).toBe(false);
    expect(emptyWindow.residentDays).toBe(0);
    expect(emptyWindow.line).toContain("No residents in census over the window");
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
      "Sent invoices dated 2026-09-01 through 2026-09-15.",
    );
    expect(billedRevenuePeriodLine({ kind: "never_recorded" })).toBe(
      "No billing period is recorded with this figure.",
    );
  });
});
