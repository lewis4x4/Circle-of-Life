import { describe, expect, it } from "vitest";

import {
  WITNESS_CHOICES,
  describeWitnessError,
  isWitnessChoice,
  witnessChoiceLabel,
  witnessSummaryLine,
  type WitnessTask,
} from "./witness";

function task(overrides: Partial<WitnessTask> = {}): WitnessTask {
  return {
    id: "followup-1",
    incidentId: "incident-1",
    incidentNumber: "HOM-2026-0007",
    careEventId: "care-event-1",
    description: "Witness statement for HOM-2026-0007",
    dueAt: "2026-09-16T22:00:00Z",
    assignedTo: "user-1",
    assignedToName: "Staff A",
    completedAt: null,
    completedBy: null,
    choice: null,
    note: null,
    ...overrides,
  };
}

describe("the three choices", () => {
  it("offers exactly the three the paper form's Section 3 asks for", () => {
    expect(WITNESS_CHOICES.map((choice) => choice.value)).toEqual(["saw_it", "did_not_see_it", "arrived_after"]);
  });

  it("gives every choice a label and a hint, so nothing needs typing to be understood", () => {
    for (const choice of WITNESS_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.hint.length).toBeGreaterThan(0);
    }
  });

  it("accepts only the three as a stored choice", () => {
    expect(isWitnessChoice("saw_it")).toBe(true);
    expect(isWitnessChoice("did_not_see_it")).toBe(true);
    expect(isWitnessChoice("arrived_after")).toBe(true);
    expect(isWitnessChoice("maybe")).toBe(false);
    expect(isWitnessChoice(null)).toBe(false);
    expect(isWitnessChoice(2)).toBe(false);
  });

  it("never shows a raw stored value on screen", () => {
    expect(witnessChoiceLabel("saw_it")).toBe("Saw it");
    expect(witnessChoiceLabel("did_not_see_it")).toBe("Did not see it");
    expect(witnessChoiceLabel("arrived_after")).toBe("Arrived after");
    expect(witnessChoiceLabel(null)).toBe("Not answered yet");
    expect(witnessChoiceLabel("something_else")).toBe("Not answered yet");
  });
});

describe("witnessSummaryLine", () => {
  it("says so plainly when nobody was asked", () => {
    expect(witnessSummaryLine([])).toBe("No witness statements were requested.");
  });

  it("counts what is outstanding", () => {
    expect(witnessSummaryLine([task(), task({ id: "followup-2" })])).toBe("2 requested, none given yet.");
  });

  it("counts what is in", () => {
    expect(
      witnessSummaryLine([
        task({ completedAt: "2026-09-16T23:00:00Z", choice: "saw_it" }),
        task({ id: "followup-2" }),
      ]),
    ).toBe("1 of 2 given.");
  });

  it("reads the same once every statement is in", () => {
    expect(
      witnessSummaryLine([
        task({ completedAt: "2026-09-16T23:00:00Z", choice: "saw_it" }),
        task({ id: "followup-2", completedAt: "2026-09-16T23:05:00Z", choice: "arrived_after" }),
      ]),
    ).toBe("2 of 2 given.");
  });
});

describe("describeWitnessError", () => {
  it("turns each database refusal into a line an aide can act on", () => {
    expect(describeWitnessError(new Error("followup: a witness statement is given by the person it was assigned to"))).toBe(
      "That statement belongs to somebody else.",
    );
    expect(describeWitnessError(new Error("followup: this task is already complete"))).toBe("That statement is already on file.");
    expect(describeWitnessError(new Error("followup: choose I saw it, I did not see it, or I arrived after"))).toBe(
      "Pick one of the three answers.",
    );
    expect(describeWitnessError(new Error("care_event: a statement that has been given stays on the record"))).toBe(
      "A statement that has been given cannot be removed.",
    );
    expect(describeWitnessError(new Error("care_event: the reporter already gave the account this event is built from"))).toBe(
      "The person who reported the event does not give a witness statement.",
    );
    expect(describeWitnessError(new Error("care_event: that staff member is not at a facility you can see"))).toBe(
      "That staff member is not at this facility.",
    );
    expect(describeWitnessError(new Error("care_event: forbidden"))).toBe("That is not yours to do.");
  });

  it("falls back without leaking the raw message", () => {
    const line = describeWitnessError(new Error("duplicate key value violates unique constraint \"whatever\""));
    expect(line).toBe("That did not save. Try again.");
    expect(line).not.toContain("constraint");
  });
});
