import { describe, expect, it } from "vitest";

import { deriveCareEvent, type CareEventAnswers, type CareEventContext } from "./level-engine";
import casesJson from "./level-cases.json";
import { applyablePrefill, kindSupportsPrefill, prefillProvenance } from "./prefill";
import {
  answersForEngine,
  initialReportState,
  reportReducer,
  type ReportState,
} from "./report-state";

type LevelCase = {
  id: string;
  kind: string;
  answers: Record<string, unknown>;
  context?: Record<string, unknown>;
};

const cases = casesJson as unknown as LevelCase[];

const RESIDENT = {
  id: "11111111-1111-1111-1111-111111111111",
  displayName: "Resident A",
  firstName: null,
  lastName: null,
  roomLabel: "Room 1",
};

function fallState(): ReportState {
  let state = initialReportState("22222222-2222-2222-2222-222222222222");
  state = reportReducer(state, { type: "pick_resident", resident: RESIDENT });
  return reportReducer(state, { type: "pick_kind", kind: "fall" });
}

describe("applyablePrefill", () => {
  it("keeps the Fall tile's own question keys and option codes", () => {
    expect(
      applyablePrefill("fall", { hurt: "a_little", head: "no", witnessed: "yes", going_out: "no" }),
    ).toEqual({ hurt: "a_little", head: "no", witnessed: "yes", going_out: "no" });
  });

  it("drops a key the tile does not ask", () => {
    // `hit_head` and `location_code` are the two shapes most likely to be
    // reached for: the tile's key is `head`, and location is not an answer at
    // all, it is a field on the submit payload.
    expect(applyablePrefill("fall", { hit_head: "yes", location_code: "bathroom" })).toEqual({});
  });

  it("drops an option code the tile does not offer", () => {
    expect(applyablePrefill("fall", { hurt: "moderately" })).toEqual({});
  });

  it("drops a multi-select row even when the value is valid", () => {
    // "Tap all that apply" is a different act from confirming one chip, and a
    // partially correct multi-select reads as complete.
    expect(applyablePrefill("injury_found", { seen: "bruise" })).toEqual({});
  });

  it("survives a malformed body without throwing", () => {
    for (const raw of [null, undefined, "nope", 7, [], { hurt: 3 }, { hurt: null }]) {
      expect(applyablePrefill("fall", raw)).toEqual({});
    }
  });

  it("offers prefill for the Fall tile only", () => {
    expect(kindSupportsPrefill("fall")).toBe(true);
    for (const kind of ["injury_found", "condition_change", "behavior", "medication"] as const) {
      expect(kindSupportsPrefill(kind)).toBe(false);
    }
    expect(kindSupportsPrefill(null)).toBe(false);
  });
});

describe("apply_prefill", () => {
  it("fills empty rows and claims them for the model", () => {
    const state = reportReducer(fallState(), {
      type: "apply_prefill",
      prefill: { hurt: "a_little", witnessed: "yes" },
      questionsVersion: "care-event-prefill-fall-v1",
    });
    expect(state.answers).toEqual({ hurt: "a_little", witnessed: "yes" });
    expect(state.prefilledByModel.sort()).toEqual(["hurt", "witnessed"]);
    expect(state.prefillQuestionsVersion).toBe("care-event-prefill-fall-v1");
  });

  it("never overwrites an answer the caregiver already tapped", () => {
    let state = reportReducer(fallState(), { type: "set_answer", key: "hurt", value: "badly" });
    state = reportReducer(state, {
      type: "apply_prefill",
      prefill: { hurt: "not_hurt", head: "no" },
      questionsVersion: "care-event-prefill-fall-v1",
    });
    expect(state.answers.hurt).toBe("badly");
    expect(state.prefilledByModel).toEqual(["head"]);
  });

  it("releases a key the caregiver changes afterward", () => {
    let state = reportReducer(fallState(), {
      type: "apply_prefill",
      prefill: { hurt: "a_little", head: "no" },
      questionsVersion: "care-event-prefill-fall-v1",
    });
    state = reportReducer(state, { type: "set_answer", key: "hurt", value: "badly" });
    expect(state.prefilledByModel).toEqual(["head"]);
    // Re-tapping the same value is still a person choosing it.
    state = reportReducer(state, { type: "set_answer", key: "head", value: "no" });
    expect(state.prefilledByModel).toEqual([]);
  });

  it("clears the model's claim when the tile changes", () => {
    let state = reportReducer(fallState(), {
      type: "apply_prefill",
      prefill: { hurt: "a_little" },
      questionsVersion: "care-event-prefill-fall-v1",
    });
    state = reportReducer(state, { type: "pick_kind", kind: "condition_change" });
    expect(state.prefilledByModel).toEqual([]);
    expect(state.prefillQuestionsVersion).toBeNull();
  });
});

describe("provenance on the submitted answers", () => {
  it("is absent when the model set nothing", () => {
    const state = reportReducer(fallState(), { type: "set_answer", key: "hurt", value: "badly" });
    expect(answersForEngine(state)).not.toHaveProperty("prefill");
  });

  it("names only the keys the caregiver left alone", () => {
    let state = reportReducer(fallState(), {
      type: "apply_prefill",
      prefill: { hurt: "a_little", head: "no", witnessed: "yes" },
      questionsVersion: "care-event-prefill-fall-v1",
    });
    state = reportReducer(state, { type: "set_answer", key: "hurt", value: "badly" });
    const answers = answersForEngine(state) as unknown as Record<string, unknown>;
    expect(answers.prefill).toEqual({
      by_model: ["head", "witnessed"],
      questions_version: "care-event-prefill-fall-v1",
    });
  });

  it("returns null without a questions version to record it under", () => {
    expect(prefillProvenance(["hurt"], null)).toBeNull();
    expect(prefillProvenance([], "care-event-prefill-fall-v1")).toBeNull();
  });
});

/**
 * The claim the whole design rests on: a prefilled answer derives the identical
 * level to the same answer tapped.
 *
 * It holds structurally rather than by luck — `care_event_derive` and its
 * TypeScript twin read named answer keys, and `prefill` is not one of them — so
 * this replays every fall case in `level-cases.json` with the provenance object
 * merged in and asserts the derivation is byte-identical.
 */
describe("prefill provenance cannot move a level", () => {
  const fallCases = cases.filter((entry) => entry.kind === "fall");

  it("covers the fall cases in level-cases.json", () => {
    expect(fallCases.length).toBeGreaterThan(0);
  });

  for (const entry of fallCases) {
    it(`derives identically with provenance attached: ${entry.id}`, () => {
      const answers = entry.answers as unknown as CareEventAnswers;
      const context = (entry.context ?? {}) as unknown as CareEventContext;
      const tapped = deriveCareEvent(entry.kind as "fall", answers, context);
      const confirmed = deriveCareEvent(
        entry.kind as "fall",
        {
          ...answers,
          prefill: { by_model: ["hurt", "head", "witnessed", "going_out"], questions_version: "x" },
        } as unknown as CareEventAnswers,
        context,
      );
      expect(confirmed).toEqual(tapped);
    });
  }
});
