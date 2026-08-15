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
