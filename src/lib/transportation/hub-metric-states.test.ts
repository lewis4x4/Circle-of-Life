import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { complianceQueueEmptyCopy, transportHubTileStates } from "./hub-metric-states";

describe("transportHubTileStates (COL-649)", () => {
  it("names the missing facility instead of Active fleet 0 / drivers 0", () => {
    const s = transportHubTileStates({ facilityReady: false, loading: false, error: null, fleetCount: 0, driverCount: 0 });
    expect(formatMetric(s.fleet)).toBe("Select a facility");
    expect(formatMetric(s.drivers)).toBe("Select a facility");
  });

  it("is unavailable after a failed read", () => {
    const s = transportHubTileStates({ facilityReady: true, loading: false, error: new Error("x"), fleetCount: 0, driverCount: 0 });
    expect(s.fleet.status).toBe("unavailable");
  });

  it("shows real counts", () => {
    const s = transportHubTileStates({ facilityReady: true, loading: false, error: null, fleetCount: 2, driverCount: 0 });
    expect(s.fleet).toEqual({ status: "value", value: 2 });
    expect(s.drivers).toEqual({ status: "value", value: 0 });
  });
});

describe("complianceQueueEmptyCopy", () => {
  it("never says Inbox Zero or No Driver Alerts with no drivers on file", () => {
    const copy = complianceQueueEmptyCopy({ kind: "driver", error: null, scopeSize: 0, windowDays: 60 });
    expect(copy.title).not.toMatch(/inbox zero|no driver alerts/i);
    expect(copy.title).toBe("No drivers on file");
  });

  it("does not claim clear after a failed read", () => {
    const copy = complianceQueueEmptyCopy({ kind: "vehicle", error: "500", scopeSize: 3, windowDays: 60 });
    expect(copy.body).toMatch(/not an all-clear/);
  });

  it("claims nothing expiring only over real records", () => {
    expect(complianceQueueEmptyCopy({ kind: "vehicle", error: null, scopeSize: 3, windowDays: 60 }).title).toBe(
      "No Vehicle Alerts",
    );
  });
});
