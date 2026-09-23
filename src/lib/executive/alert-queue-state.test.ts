import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { ALERT_QUEUE_EMPTY_COPY, alertSeverityTileState, resolveAlertQueueStatus } from "./alert-queue-state";

describe("executive alert queue state (COL-649)", () => {
  it("a failed read is unavailable, not an empty queue", () => {
    const status = resolveAlertQueueStatus({ loading: false, error: "500", organizationId: "org", rowCount: 0 });
    expect(status).toBe("unavailable");
    expect(formatMetric(alertSeverityTileState(status, 0))).toBe("Unavailable");
  });

  it("no organization is not configured, not zero", () => {
    const status = resolveAlertQueueStatus({ loading: false, error: null, organizationId: null, rowCount: 0 });
    expect(formatMetric(alertSeverityTileState(status, 0))).toBe("No organization");
  });

  it("an empty successful read says what it does not cover", () => {
    const status = resolveAlertQueueStatus({ loading: false, error: null, organizationId: "org", rowCount: 0 });
    expect(status).toBe("empty");
    expect(formatMetric(alertSeverityTileState(status, 0))).toBe("0");
    expect(ALERT_QUEUE_EMPTY_COPY.headline).not.toMatch(/clear/i);
    expect(ALERT_QUEUE_EMPTY_COPY.body).toContain("not an all-clear");
  });
});
