import { describe, expect, it } from "vitest";

import {
  complianceRateMetric,
  formatCompliancePercent,
  COMPLIANCE_NO_HALL_LABEL,
  COMPLIANCE_NO_SHIFT_LABEL,
  COMPLIANCE_NO_STAFF_LABEL,
  COMPLIANCE_NO_TASK_LABEL,
  complianceRate,
  formatComplianceRate,
  onTimeRate,
  summarizeObservationCompliance,
  type ComplianceRow,
} from "./observation-compliance-summary";

function row(overrides: Partial<ComplianceRow>): ComplianceRow {
  return {
    resident_id: "resident-1",
    service_date: "2026-09-17",
    window_key: "mid_morning",
    shift_key: "day",
    task_id: "task-1",
    task_status: "completed_on_time",
    satisfied: true,
    absorbed: false,
    expectation_source: "standard_task",
    ...overrides,
  };
}

const shiftLabels = new Map([
  ["day", "Day"],
  ["night", "Night"],
]);

describe("observation compliance summary", () => {
  it("counts expected, satisfied and unconfigured from the projected rows", () => {
    const summary = summarizeObservationCompliance({
      from: "2026-09-17",
      to: "2026-09-17",
      rows: [
        row({}),
        row({ window_key: "afternoon", satisfied: false, task_status: "missed" }),
        row({
          resident_id: "resident-2",
          window_key: null,
          shift_key: null,
          task_id: null,
          task_status: null,
          satisfied: false,
          expectation_source: "no_cadence",
        }),
      ],
      shiftLabels,
      hallByResident: new Map(),
      staffByTask: new Map(),
    });

    expect(summary.totals.expected).toBe(2);
    expect(complianceRate(summary.totals)).toBe(0.5);
    expect(summary.totals.satisfied).toBe(1);
    expect(summary.totals.unconfigured).toBe(1);
    expect(summary.totals.withTask).toBe(2);
    expect(summary.totals.onTime).toBe(1);
  });

  /**
   * Build notes 4b: a surface that shows satisfied over expected and hides the
   * `no_cadence` count has reintroduced the defect at the UI layer. The
   * unconfigured count therefore survives every cut, not just the total.
   */
  it("carries the unconfigured count into every cut, never rounded away", () => {
    const summary = summarizeObservationCompliance({
      from: "2026-09-17",
      to: "2026-09-17",
      rows: [
        row({}),
        row({
          resident_id: "resident-2",
          window_key: null,
          shift_key: null,
          task_id: null,
          task_status: null,
          satisfied: false,
          expectation_source: "no_cadence",
        }),
      ],
      shiftLabels,
      hallByResident: new Map([["resident-1", { key: "unit-1", label: "East hall" }]]),
      staffByTask: new Map([["task-1", { key: "staff-1", label: "Staff One" }]]),
    });

    const noCadenceShift = summary.byShift.find((cut) => cut.label === COMPLIANCE_NO_SHIFT_LABEL);
    expect(noCadenceShift?.unconfigured).toBe(1);
    expect(noCadenceShift?.satisfied).toBe(0);

    const noHall = summary.byHall.find((cut) => cut.label === COMPLIANCE_NO_HALL_LABEL);
    expect(noHall?.unconfigured).toBe(1);

    const noTask = summary.byStaff.find((cut) => cut.label === COMPLIANCE_NO_TASK_LABEL);
    expect(noTask?.unconfigured).toBe(1);
  });

  it("never shows two staff rows with the same name (COL-662)", () => {
    const summary = summarizeObservationCompliance({
      from: "2026-09-17",
      to: "2026-09-17",
      rows: [row({ task_id: null }), row({ task_id: "task-unassigned" })],
      shiftLabels,
      hallByResident: new Map(),
      staffByTask: new Map([["task-unassigned", { key: "no_staff", label: COMPLIANCE_NO_STAFF_LABEL }]]),
    });
    const labels = summary.byStaff.map((cut) => cut.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(expect.arrayContaining([COMPLIANCE_NO_TASK_LABEL, COMPLIANCE_NO_STAFF_LABEL]));
  });

  it("names a window whose shift has no definition row rather than borrowing a shift", () => {
    const summary = summarizeObservationCompliance({
      from: "2026-09-17",
      to: "2026-09-17",
      rows: [row({ shift_key: "orphaned" })],
      shiftLabels,
      hallByResident: new Map(),
      staffByTask: new Map(),
    });
    expect(summary.byShift[0].label).toBe("No shift posted");
  });

  /**
   * A window a Monitoring Order check absorbed has no task behind it and no
   * completion time to be on time against, so it cannot count against the
   * on-time denominator. Counting it would report absorbed checks as late work
   * by somebody.
   */
  it("keeps absorbed windows out of the on-time denominator", () => {
    const summary = summarizeObservationCompliance({
      from: "2026-09-17",
      to: "2026-09-17",
      rows: [
        row({ task_id: null, task_status: null, absorbed: true, expectation_source: "monitoring_order" }),
        row({ window_key: "afternoon", task_status: "completed_on_time" }),
      ],
      shiftLabels,
      hallByResident: new Map(),
      staffByTask: new Map(),
    });
    expect(summary.totals.expected).toBe(2);
    expect(summary.totals.satisfied).toBe(2);
    expect(summary.totals.absorbed).toBe(1);
    expect(summary.totals.withTask).toBe(1);
    expect(onTimeRate(summary.totals)).toBe(1);
  });

  it("answers null rather than a hundred percent when there is nothing to divide by", () => {
    const empty = {
      expected: 0,
      satisfied: 0,
      unconfigured: 0,
      absorbed: 0,
      withTask: 0,
      onTime: 0,
      late: 0,
    };
    expect(complianceRate(empty)).toBeNull();
    expect(onTimeRate(empty)).toBeNull();
    expect(formatComplianceRate(null)).toBe("No data posted");
    expect(formatComplianceRate(0.84)).toBe("84%");
  });
});

it.each(["no_cadence", "orphaned_shift"])("keeps %s gaps out of compliance and missing-work totals", (source) => {
  const summarize = (rows: ComplianceRow[]) => summarizeObservationCompliance({
    from: "2026-09-18", to: "2026-09-18", rows,
    shiftLabels: new Map(), hallByResident: new Map(), staffByTask: new Map(),
  });
  const gap = row({ expectation_source: source, satisfied: false, task_id: null, task_status: null });
  const mixed = summarize([row({}), gap]);
  expect(complianceRate(mixed.totals)).toBe(1);
  expect(mixed.totals.expected - mixed.totals.satisfied).toBe(0);
  expect(mixed.totals.unconfigured).toBe(1);
  expect(complianceRate(summarize([gap]).totals)).toBeNull();
});

describe("complianceRateMetric (COL-649)", () => {
  it("has no value (and so no red threshold) without a denominator", () => {
    expect(complianceRateMetric(null)).toEqual({ status: "no_data", reason: "No data posted" });
  });

  it("is a percentage when there is a rate", () => {
    expect(complianceRateMetric(0.84)).toEqual({ status: "value", value: 84 });
    expect(formatCompliancePercent(84.4)).toBe("84%");
  });
});
