import { describe, expect, it } from "vitest";

import { CAREGIVER_EMAR_NO_INSTRUCTIONS_COPY } from "./emar-queue-copy";
import { buildEmarQueueSlots, type MedRowInput } from "./emar-queue";

const TIME_ZONE = "America/New_York";

function scheduledMed(overrides: Partial<MedRowInput> = {}): MedRowInput {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    resident_id: "00000000-0000-4000-8000-000000000002",
    medication_name: "Placeholder Med",
    strength: "10 mg",
    route: "oral",
    frequency: "daily",
    scheduled_times: ["14:00:00"],
    instructions: null,
    resident: { first_name: "Placeholder", last_name: "Resident" },
    roomLabel: "101-A",
    ...overrides,
  };
}

describe("buildEmarQueueSlots scheduled instructions", () => {
  it("names the gap when instructions are missing", () => {
    const now = new Date("2026-08-15T18:00:00.000Z");
    const slots = buildEmarQueueSlots([scheduledMed()], TIME_ZONE, now, new Set());

    expect(slots).toHaveLength(1);
    expect(slots[0]?.instructions).toBe(CAREGIVER_EMAR_NO_INSTRUCTIONS_COPY);
  });

  it("keeps trimmed posted instructions on scheduled slots", () => {
    const now = new Date("2026-08-15T18:00:00.000Z");
    const slots = buildEmarQueueSlots(
      [scheduledMed({ instructions: " Take with food " })],
      TIME_ZONE,
      now,
      new Set(),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]?.instructions).toBe("Take with food");
  });
});

describe("unresolved medication work", () => {
  it("retains doses overdue by four hours as due now", () => {
    const slots = buildEmarQueueSlots([scheduledMed()], TIME_ZONE, new Date("2026-08-15T22:00:00Z"), new Set());
    expect(slots).toHaveLength(1);
    expect(slots[0].urgency).toBe("due-now");
  });
  it("keeps a PRN available after a prior administration and uses actual request time", () => {
    const med = scheduledMed({ frequency: "prn" });
    const now = new Date("2026-08-15T22:00:00Z");
    const slots = buildEmarQueueSlots([med], TIME_ZONE, now, new Set([`prn|${med.id}|2026-08-15`]));
    expect(slots).toHaveLength(1);
    expect(slots[0].scheduledTimeIso).toBe(now.toISOString());
  });
});

it("does not present a weekly order as a daily dose", () => {
 const med = scheduledMed({ frequency: "weekly", start_date: "2026-08-14" });
 expect(buildEmarQueueSlots([med], TIME_ZONE, new Date("2026-08-15T18:00:00Z"), new Set())).toHaveLength(0);
 expect(buildEmarQueueSlots([med], TIME_ZONE, new Date("2026-08-21T18:00:00Z"), new Set())).toHaveLength(1);
});
