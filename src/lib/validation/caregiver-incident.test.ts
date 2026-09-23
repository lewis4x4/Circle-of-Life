import { describe, expect, it } from "vitest";

import { caregiverIncidentFormSchema } from "@/lib/validation/caregiver-incident";

const complete = {
  residentId: "",
  category: "fall_without_injury",
  severity: "level_1",
  occurredAtLocal: "2026-09-23T14:05",
  shift: "day",
  locationDescription: "Room 12",
  description: "Found seated on the floor beside the bed.",
  immediateActions: "Assessed, assisted up, notified family.",
  injuryOccurred: false,
};

describe("caregiverIncidentFormSchema (COL-653)", () => {
  it("refuses a record whose category, severity or shift was never chosen, in staff words", () => {
    const result = caregiverIncidentFormSchema.safeParse({ ...complete, category: "", severity: "", shift: "" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toEqual(
      expect.arrayContaining(["Choose a category", "Choose a severity", "Choose the shift"]),
    );
    expect(messages.join(" ")).not.toMatch(/fall_|level_|expected/);
  });

  it("accepts the record once each is chosen", () => {
    expect(caregiverIncidentFormSchema.safeParse(complete).success).toBe(true);
  });
});
