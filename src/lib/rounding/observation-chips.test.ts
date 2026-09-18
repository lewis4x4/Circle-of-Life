import { describe, expect, it } from "vitest";

import {
  composeObservationPreview,
  countObservationChips,
  describeObservationGaps,
  emptyObservationVocabCatalog,
  isObservationSubmittable,
  normalizeObservationChips,
  toggleObservationChip,
  type ObservationDraft,
  type ObservationVocabCatalog,
} from "./observation-chips";

function catalog(): ObservationVocabCatalog {
  return {
    ...emptyObservationVocabCatalog(),
    location: [
      { code: "dining_room", label: "Dining Room" },
      { code: "resident_room", label: "Resident Room" },
    ],
    position: [{ code: "sitting", label: "Sitting" }],
    state: [{ code: "eating_meal", label: "Eating Meal/Snack" }],
    meal_intake: [
      { code: "ate_well", label: "Ate well" },
      { code: "refused_meal", label: "Refused meal" },
    ],
    mood_state: [
      { code: "pleasant", label: "Pleasant" },
      { code: "agitated", label: "Agitated" },
    ],
    med_response: [
      { code: "took_meds", label: "Took meds" },
      { code: "refused_meds", label: "Refused meds" },
    ],
  };
}

function draft(overrides: Partial<ObservationDraft> = {}): ObservationDraft {
  return {
    quickStatus: "awake",
    residentLocation: "dining_room",
    residentState: "eating_meal",
    chipSelections: { meal_intake: ["ate_well"] },
    ...overrides,
  };
}

describe("composition order", () => {
  it("puts meals, then mood, then medications ahead of the status and the place", () => {
    expect(
      composeObservationPreview(
        draft({ chipSelections: { med_response: ["took_meds"], mood_state: ["pleasant"], meal_intake: ["ate_well"] } }),
        catalog(),
      ),
    ).toBe("Ate well, pleasant, took meds. Awake, Eating Meal/Snack. In Dining Room.");
  });

  it("keeps the capital on the first chip only, so the clause reads as prose", () => {
    expect(composeObservationPreview(draft({ chipSelections: { mood_state: ["agitated"], med_response: ["refused_meds"] } }), catalog()))
      .toBe("Agitated, refused meds. Awake, Eating Meal/Snack. In Dining Room.");
  });

  it("orders each group by the vocabulary rather than by tap order", () => {
    const selections = toggleObservationChip(toggleObservationChip({}, "mood_state", "agitated"), "mood_state", "pleasant");
    expect(normalizeObservationChips(selections, catalog())).toEqual({ mood_state: ["pleasant", "agitated"] });
    expect(composeObservationPreview(draft({ chipSelections: selections }), catalog()))
      .toBe("Pleasant, agitated. Awake, Eating Meal/Snack. In Dining Room.");
  });

  it("omits a clause it has nothing for", () => {
    expect(composeObservationPreview({ quickStatus: "asleep", residentLocation: null, residentState: null, chipSelections: { mood_state: ["pleasant"] } }, catalog()))
      .toBe("Pleasant. Asleep.");
  });

  it("appends the position after the location inside the same clause", () => {
    expect(composeObservationPreview(draft({ residentPosition: "sitting" }), catalog()))
      .toBe("Ate well. Awake, Eating Meal/Snack. In Dining Room, Sitting.");
  });
});

describe("chips required, note optional", () => {
  it("records with an empty note", () => {
    expect(isObservationSubmittable(draft({ note: "" }))).toBe(true);
    expect(isObservationSubmittable(draft({ note: null }))).toBe(true);
  });

  it("refuses when no chip from the three groups is tapped", () => {
    expect(isObservationSubmittable(draft({ chipSelections: {} }))).toBe(false);
    expect(isObservationSubmittable(draft({ chipSelections: {}, note: "A long and detailed note" }))).toBe(false);
  });

  it("accepts a chip from any one of the three groups", () => {
    expect(isObservationSubmittable(draft({ chipSelections: { mood_state: ["pleasant"] } }))).toBe(true);
    expect(isObservationSubmittable(draft({ chipSelections: { med_response: ["refused_meds"] } }))).toBe(true);
  });

  it("still requires the three retained fields", () => {
    expect(isObservationSubmittable(draft({ residentLocation: null }))).toBe(false);
    expect(isObservationSubmittable(draft({ residentState: "  " }))).toBe(false);
    expect(isObservationSubmittable(draft({ quickStatus: null }))).toBe(false);
  });

  it("never names the note when it says what is missing", () => {
    const gaps = describeObservationGaps(draft({ chipSelections: {}, residentLocation: null, note: "" })).join(" ");
    expect(gaps).not.toMatch(/note/i);
    expect(gaps).toContain("a meal, mood or medication chip");
  });

  it("counts and untoggles", () => {
    const once = toggleObservationChip({}, "meal_intake", "ate_well");
    expect(countObservationChips(once)).toBe(1);
    expect(countObservationChips(toggleObservationChip(once, "meal_intake", "ate_well"))).toBe(0);
    expect(toggleObservationChip(once, "meal_intake", "ate_well")).toEqual({});
  });

  it("keeps a code the catalog does not know so the server can refuse it rather than it vanishing", () => {
    expect(normalizeObservationChips({ meal_intake: ["not_a_real_code", "ate_well"] }, catalog()))
      .toEqual({ meal_intake: ["ate_well", "not_a_real_code"] });
  });
});
