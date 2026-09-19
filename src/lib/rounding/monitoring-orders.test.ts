import { describe, expect, it } from "vitest";

import {
  emptyMonitoringOrderDraft,
  intervalLabel,
  orderSummaryLine,
  orderedByLabel,
  reasonLabel,
  receivedAsLabel,
  remainingWindow,
  validateMonitoringOrderDraft,
  type ActiveMonitoringOrder,
  type IntervalOptions,
  type MonitoringOrderDraft,
} from "@/lib/rounding/monitoring-orders";

// The presets and bounds come from public.monitoring_order_interval_options at
// runtime. The fixture stands in for that row, which is why the numbers live
// here and not in the module under test.
const OPTIONS: IntervalOptions = { presetMinutes: [30, 60, 120, 240], minMinutes: 15, maxMinutes: 720 };

const START = "2026-09-16T21:00:00.000Z";

function draft(overrides: Partial<MonitoringOrderDraft> = {}): MonitoringOrderDraft {
  return {
    ...emptyMonitoringOrderDraft(START),
    intervalMinutes: 30,
    orderedByType: "hospital_discharge",
    orderedByName: "Discharging hospital",
    orderReceivedAs: "discharge_paperwork",
    reasonCategory: "post_hospital_return",
    reasonNote: "Thirty minute checks for the first day back.",
    reviewDueAt: "2026-09-19T21:00:00.000Z",
    ...overrides,
  };
}

describe("intervalLabel", () => {
  it("says hours when the interval is a whole number of them", () => {
    expect(intervalLabel(60)).toBe("Every hour");
    expect(intervalLabel(120)).toBe("Every 2 hours");
    expect(intervalLabel(240)).toBe("Every 4 hours");
  });

  it("says minutes otherwise", () => {
    expect(intervalLabel(30)).toBe("Every 30 minutes");
    expect(intervalLabel(90)).toBe("Every 90 minutes");
  });

  it("does not invent a reading for a missing interval", () => {
    expect(intervalLabel(0)).toBe("Interval not set");
    expect(intervalLabel(Number.NaN)).toBe("Interval not set");
  });
});

describe("vocabulary", () => {
  it("never renders a raw enum value", () => {
    expect(orderedByLabel("hospital_discharge")).toBe("Hospital discharge");
    expect(receivedAsLabel("discharge_paperwork")).toBe("Discharge paperwork");
    expect(reasonLabel("post_hospital_return")).toBe("Back from hospital");
  });

  it("falls back to operator words for something it does not know", () => {
    expect(orderedByLabel("something_new")).toBe("Not recorded");
    expect(reasonLabel("")).toBe("Not recorded");
  });

  it("never uses the word watch", () => {
    const everyLabel = [
      orderedByLabel("facility_nurse"),
      receivedAsLabel("written_order"),
      reasonLabel("elopement_risk"),
      intervalLabel(30),
    ].join(" ");
    expect(everyLabel.toLowerCase()).not.toContain("watch");
  });
});

describe("emptyMonitoringOrderDraft", () => {
  it("fills in only the start time, and only because the event is time sensitive", () => {
    const blank = emptyMonitoringOrderDraft(START);
    expect(blank.startsAt).toBe(START);
    expect(blank.intervalMinutes).toBeNull();
    expect(blank.orderedByType).toBe("");
    expect(blank.orderReceivedAs).toBe("");
    expect(blank.reasonCategory).toBe("");
    expect(blank.reasonNote).toBe("");
    expect(blank.endsAt).toBe("");
    expect(blank.reviewDueAt).toBe("");
  });
});

describe("validateMonitoringOrderDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateMonitoringOrderDraft(draft(), OPTIONS)).toEqual([]);
  });

  it("requires a review date when there is no end date", () => {
    const problems = validateMonitoringOrderDraft(draft({ endsAt: "", reviewDueAt: "" }), OPTIONS);
    expect(problems).toContain(
      "An order with no end date needs a review date, so somebody has to decide about it again.",
    );
  });

  it("accepts an end date instead of a review date", () => {
    expect(
      validateMonitoringOrderDraft(draft({ endsAt: "2026-09-18T21:00:00.000Z", reviewDueAt: "" }), OPTIONS),
    ).toEqual([]);
  });

  it("rejects an interval outside the bounds the database enforces", () => {
    expect(validateMonitoringOrderDraft(draft({ intervalMinutes: 5 }), OPTIONS)).toEqual([
      "A custom interval has to be a whole number between 15 and 720 minutes.",
    ]);
    expect(validateMonitoringOrderDraft(draft({ intervalMinutes: 1000 }), OPTIONS)).toEqual([
      "A custom interval has to be a whole number between 15 and 720 minutes.",
    ]);
  });

  it("rejects an end that does not come after the start", () => {
    const problems = validateMonitoringOrderDraft(
      draft({ endsAt: "2026-09-16T20:00:00.000Z", reviewDueAt: "" }),
      OPTIONS,
    );
    expect(problems).toContain("The end has to come after the start.");
  });

  it("names every missing field rather than the first one", () => {
    const problems = validateMonitoringOrderDraft(emptyMonitoringOrderDraft(START), OPTIONS);
    expect(problems).toHaveLength(7);
  });

  it("does not treat whitespace as an answer", () => {
    const problems = validateMonitoringOrderDraft(draft({ orderedByName: "   ", reasonNote: "  " }), OPTIONS);
    expect(problems).toContain("Name the ordering person or facility.");
    expect(problems).toContain("Write one line about why.");
  });
});

describe("remainingWindow", () => {
  const base: ActiveMonitoringOrder = {
    id: "order-1",
    intervalMinutes: 30,
    startsAt: START,
    endsAt: null,
    reviewDueAt: null,
    orderedByType: "hospital_discharge",
    orderedByName: "Discharging hospital",
    orderReceivedAs: "discharge_paperwork",
    reasonCategory: "post_hospital_return",
    reasonNote: "Thirty minute checks for the first day back.",
  };

  it("counts down to an end date", () => {
    const window = remainingWindow({ ...base, endsAt: "2026-09-18T21:00:00.000Z" }, START);
    expect(window).toEqual({ label: "2 days left", reviewOverdue: false });
  });

  it("says so once an end date has gone by", () => {
    const window = remainingWindow({ ...base, endsAt: "2026-09-15T21:00:00.000Z" }, START);
    expect(window).toEqual({ label: "Past its end time", reviewOverdue: false });
  });

  it("counts down to the review date on an open ended order", () => {
    const window = remainingWindow({ ...base, reviewDueAt: "2026-09-17T03:00:00.000Z" }, START);
    expect(window).toEqual({ label: "Open ended, review due in 6 hours", reviewOverdue: false });
  });

  it("flags an open ended order whose review date has passed, and does not call it expired", () => {
    const window = remainingWindow({ ...base, reviewDueAt: "2026-09-14T21:00:00.000Z" }, START);
    expect(window.reviewOverdue).toBe(true);
    expect(window.label).toBe("Open ended, review was due 2 days ago");
    expect(window.label.toLowerCase()).not.toContain("expired");
  });

  it("says open ended when there is nothing to count down to", () => {
    expect(remainingWindow(base, START)).toEqual({ label: "Open ended", reviewOverdue: false });
  });

  it("rounds a sub-hour remainder up to at least a minute", () => {
    const window = remainingWindow({ ...base, endsAt: "2026-09-16T21:00:30.000Z" }, START);
    expect(window.label).toBe("1 minute left");
  });
});

describe("orderSummaryLine", () => {
  it("leads with interval, reason and ordering party, in operator words", () => {
    const line = orderSummaryLine({
      id: "order-1",
      intervalMinutes: 120,
      startsAt: START,
      endsAt: null,
      reviewDueAt: null,
      orderedByType: "physician",
      orderedByName: "Ordering physician",
      orderReceivedAs: "verbal",
      reasonCategory: "post_fall",
      reasonNote: "Checked after a fall.",
    });
    expect(line).toBe("Every 2 hours · After a fall · Physician");
  });
});
