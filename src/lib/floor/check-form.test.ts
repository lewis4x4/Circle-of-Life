import { describe, expect, it } from "vitest";

import { floorPinMismatchCopy } from "./contract";
import { checkFailureCopy } from "./check-submit";
import { buildFloorCompletionPayload, checkQuestion, emptyFloorCheckDraft, floorCheckGaps, residentPronoun, toggleValue } from "./check-form";

describe("floor check form", () => {
  it("maps every chip onto the existing completion payload fields", () => {
    const payload = buildFloorCompletionPayload({
      quickStatus: "awake",
      location: "in_chair",
      helpedWith: ["hydration_offered"],
      anythingWrong: ["pain_concern", "fall_hazard_observed"],
      lateReason: "  With another resident  ",
    });
    expect(payload).toEqual({
      quickStatus: "awake",
      residentLocation: "in_chair",
      toiletingAssisted: false,
      hydrationOffered: true,
      repositioned: false,
      painConcern: true,
      breathingConcern: false,
      skinConcernObserved: false,
      fallHazardObserved: true,
      refusedAssistance: false,
      distressPresent: false,
      note: null,
      lateReason: "With another resident",
    });
  });

  it("never sends chip-capture selections, so the device can replay an offline check", () => {
    expect(buildFloorCompletionPayload({ ...emptyFloorCheckDraft(), quickStatus: "calm" })).not.toHaveProperty("chipSelections");
  });

  it("sets distress and refused help from the quick status, as the caregiver capture does", () => {
    expect(buildFloorCompletionPayload({ ...emptyFloorCheckDraft(), quickStatus: "distressed" }).distressPresent).toBe(true);
    expect(buildFloorCompletionPayload({ ...emptyFloorCheckDraft(), quickStatus: "refused" }).refusedAssistance).toBe(true);
  });

  it("needs how they are, and a reason once the check is over", () => {
    expect(floorCheckGaps(emptyFloorCheckDraft(), { lateReasonRequired: false })).toEqual(["Pick how they are."]);
    const draft = { ...emptyFloorCheckDraft(), quickStatus: "awake" as const };
    expect(floorCheckGaps(draft, { lateReasonRequired: false })).toEqual([]);
    expect(floorCheckGaps(draft, { lateReasonRequired: true })).toEqual(["Say why the check is late."]);
    expect(floorCheckGaps({ ...draft, lateReason: "Fall in 104" }, { lateReasonRequired: true })).toEqual([]);
  });

  it("takes the pronoun from the record and stays neutral otherwise", () => {
    expect(checkQuestion("how", residentPronoun("female"))).toBe("How is she?");
    expect(checkQuestion("where", residentPronoun("male"))).toBe("Where is he?");
    expect(checkQuestion("how", residentPronoun(null))).toBe("How are they?");
    expect(checkQuestion("where", residentPronoun("prefer_not_to_say"))).toBe("Where are they?");
  });

  it("toggles an any-of chip on and off", () => {
    expect(toggleValue(["pain_concern"], "skin_concern_observed")).toEqual(["pain_concern", "skin_concern_observed"]);
    expect(toggleValue(["pain_concern"], "pain_concern")).toEqual([]);
  });
});

describe("operator copy for refusals", () => {
  it("counts the PIN tries left, singular and plural, and stays plain without a count", () => {
    expect(floorPinMismatchCopy(3)).toBe("That PIN did not match. 3 tries left.");
    expect(floorPinMismatchCopy(1)).toBe("That PIN did not match. 1 try left.");
    expect(floorPinMismatchCopy(0)).toBe("Locked for 15 minutes. Ask the administrator.");
    expect(floorPinMismatchCopy(undefined)).toBe("That PIN did not match.");
  });

  it("maps a refused check save by status, never by the route's text", () => {
    expect(checkFailureCopy(400)).toBe("This check could not be saved as charted. Check the answers, then try again.");
    expect(checkFailureCopy(403)).toContain("another sign-in");
    expect(checkFailureCopy(404)).toContain("not on the list");
    expect(checkFailureCopy(500)).toBe("The check was not saved. Try again, or tell the administrator.");
  });
});
