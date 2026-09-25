import { describe, expect, it } from "vitest";

import { emptyObservationVocabCatalog, type ObservationVocabCatalog } from "@/lib/rounding/observation-chips";

import { floorPinMismatchCopy } from "./contract";
import { checkFailureCopy } from "./check-submit";
import {
  buildFloorCompletionPayload,
  checkQuestion,
  emptyFloorCheckDraft,
  floorCheckGaps,
  floorCheckVocabFromRows,
  residentPronoun,
  toggleValue,
  type FloorCheckDraft,
} from "./check-form";

const VOCAB: ObservationVocabCatalog = {
  ...emptyObservationVocabCatalog(),
  meal_intake: [{ code: "ate_well", label: "Ate well" }, { code: "ate_some", label: "Ate some" }],
  mood_state: [{ code: "pleasant", label: "Pleasant" }, { code: "quiet", label: "Quiet" }],
  med_response: [{ code: "took_meds", label: "Took meds" }],
};

const READY: FloorCheckDraft = {
  ...emptyFloorCheckDraft(),
  quickStatus: "awake",
  location: "dining_room",
  residentState: "eating_meal",
  chips: { meal_intake: ["ate_well"] },
};

describe("floor check form", () => {
  it("maps every chip onto the existing completion payload fields", () => {
    const payload = buildFloorCompletionPayload(
      {
        quickStatus: "awake",
        location: "common_area",
        residentState: "watching_tv",
        chips: { mood_state: ["quiet", "pleasant"], meal_intake: ["ate_some"] },
        helpedWith: ["hydration_offered"],
        anythingWrong: ["pain_concern", "fall_hazard_observed"],
        lateReason: "  With another resident  ",
      },
      VOCAB,
    );
    expect(payload).toEqual({
      captureSurface: "floor",
      quickStatus: "awake",
      residentLocation: "common_area",
      residentState: "watching_tv",
      chipSelections: { meal_intake: ["ate_some"], mood_state: ["pleasant", "quiet"] },
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

  it("carries what require_observation_capture needs: location, state and a chip group to code map", () => {
    const payload = buildFloorCompletionPayload({ ...READY, chips: { med_response: ["took_meds"] } }, VOCAB);
    expect(payload.residentLocation).toBe("dining_room");
    expect(payload.residentState).toBe("eating_meal");
    expect(payload.chipSelections).toEqual({ med_response: ["took_meds"] });
    expect(Object.keys(payload.chipSelections ?? {}).every((group) => ["meal_intake", "mood_state", "med_response"].includes(group))).toBe(true);
    // Marked so the route and the device replay both use the review writer, which keeps the flat answers.
    expect(payload.captureSurface).toBe("floor");
  });

  it("sets distress and refused help from the quick status, as the caregiver capture does", () => {
    expect(buildFloorCompletionPayload({ ...READY, quickStatus: "distressed" }, VOCAB).distressPresent).toBe(true);
    expect(buildFloorCompletionPayload({ ...READY, quickStatus: "refused" }, VOCAB).refusedAssistance).toBe(true);
  });

  it("needs how, where, what they are doing and a meal, mood or medication pick, and a reason once the check is over", () => {
    expect(floorCheckGaps(emptyFloorCheckDraft(), { lateReasonRequired: false })).toEqual([
      "Pick how they are.",
      "Pick where they are.",
      "Pick what they are doing.",
      "Pick at least one for meals, mood or medications.",
    ]);
    expect(floorCheckGaps(READY, { lateReasonRequired: false })).toEqual([]);
    expect(floorCheckGaps({ ...READY, chips: {} }, { lateReasonRequired: false })).toEqual(["Pick at least one for meals, mood or medications."]);
    expect(floorCheckGaps({ ...READY, chips: { meal_intake: [] } }, { lateReasonRequired: false })).toEqual(["Pick at least one for meals, mood or medications."]);
    expect(floorCheckGaps({ ...READY, location: null }, { lateReasonRequired: false })).toEqual(["Pick where they are."]);
    expect(floorCheckGaps({ ...READY, residentState: " " }, { lateReasonRequired: false })).toEqual(["Pick what they are doing."]);
    expect(floorCheckGaps(READY, { lateReasonRequired: true })).toEqual(["Say why the check is late."]);
    expect(floorCheckGaps({ ...READY, lateReason: "Fall in 104" }, { lateReasonRequired: true })).toEqual([]);
  });

  it("reads the facility's choices: in-building places, each code once, the facility's own label first", () => {
    const row = (field_name: string, value_code: string, display_order: number, facility_id: string | null = null, is_oof = false) =>
      ({ field_name, value_code, display_label: `${value_code} ${facility_id ? "here" : "org"}`, display_order, facility_id, is_oof });
    const vocab = floorCheckVocabFromRows([
      row("location", "dining_room", 2),
      row("location", "common_area", 1),
      row("location", "oof_personal_errand", 9, null, true),
      row("state", "sleeping", 5),
      row("state", "watching_tv", 3),
      row("mood_state", "pleasant", 1),
      row("mood_state", "pleasant", 1, "facility-1"),
      row("mood_state", "quiet", 2, "facility-other"),
      row("meal_intake", "ate_well", 1),
    ], "facility-1");
    expect(vocab.location.map((option) => option.code)).toEqual(["common_area", "dining_room"]);
    expect(vocab.state.map((option) => option.code)).toEqual(["watching_tv", "sleeping"]);
    expect(vocab.mood_state).toEqual([{ code: "pleasant", label: "pleasant here" }]);
    expect(vocab.meal_intake).toEqual([{ code: "ate_well", label: "ate_well org" }]);
    expect(vocab.med_response).toEqual([]);
    expect(vocab.position).toEqual([]);
  });

  it("takes the pronoun from the record and stays neutral otherwise", () => {
    expect(checkQuestion("doing", residentPronoun("female"))).toBe("What is she doing?");
    expect(checkQuestion("doing", residentPronoun(null))).toBe("What are they doing?");
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
