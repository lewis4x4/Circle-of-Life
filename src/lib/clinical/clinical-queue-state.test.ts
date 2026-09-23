import { describe, expect, it } from "vitest";

import { clinicalQueueCount, describeClinicalQueue, formatQueueChip } from "./clinical-queue-state";

describe("describeClinicalQueue (COL-649)", () => {
  it("an empty queue over zero records on file is a gap, not a clear", () => {
    expect(describeClinicalQueue({ scopeReady: true, scopeSize: 0, itemCount: 0 })).toBe("nothing_on_file");
  });

  it("an empty queue with no facility chosen asks for one", () => {
    expect(describeClinicalQueue({ scopeReady: false, scopeSize: 12, itemCount: 0 })).toBe("needs_facility");
  });

  it("a failed read or an unread scope is unavailable", () => {
    expect(describeClinicalQueue({ scopeReady: true, error: "403", scopeSize: 12, itemCount: 0 })).toBe("unavailable");
    expect(describeClinicalQueue({ scopeReady: true, scopeSize: null, itemCount: 0 })).toBe("unavailable");
  });

  it("clear only when records exist and none are due", () => {
    expect(describeClinicalQueue({ scopeReady: true, scopeSize: 12, itemCount: 0 })).toBe("clear");
    expect(describeClinicalQueue({ scopeReady: true, scopeSize: 12, itemCount: 2 })).toBe("items");
  });
});

describe("queue chips", () => {
  it("never print 0 for a queue that could not be measured", () => {
    expect(formatQueueChip(clinicalQueueCount("nothing_on_file", 0, "No assessments on file"), "overdue")).toBe(
      "Overdue: No assessments on file",
    );
    expect(formatQueueChip(clinicalQueueCount("needs_facility", 0, "x"), "overdue")).toBe("Overdue: Select a facility");
    expect(formatQueueChip(clinicalQueueCount("unavailable", 0, "x"), "needed")).toBe("Needed: Unavailable");
  });

  it("print the real count once the queue earned one", () => {
    expect(formatQueueChip(clinicalQueueCount("clear", 0, "x"), "overdue")).toBe("0 overdue");
    expect(formatQueueChip(clinicalQueueCount("items", 3, "x"), "overdue")).toBe("3 overdue");
  });
});
