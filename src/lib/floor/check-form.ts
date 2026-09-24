/**
 * "Chart a check" on the floor tablet (spec 40 §6 screen 5, DESIGN.md 05):
 * the rounding completion payload as chips. Every chip maps onto one existing
 * `CompletionPayload` field; nothing here is a new kind of answer.
 *
 * The tablet sends the flat fields, not `chipSelections`, so a check charted
 * offline can be replayed by the device after someone else unlocks
 * (`selectFloorReplayItems` holds chip-capture items for their owner).
 */

import type { CompletionPayload, ObservationQuickStatus } from "@/lib/rounding/types";

export type ChipOption<T extends string> = { value: T; label: string };

export const FLOOR_QUICK_STATUS_OPTIONS: ReadonlyArray<ChipOption<ObservationQuickStatus>> = [
  { value: "awake", label: "Awake" },
  { value: "asleep", label: "Asleep" },
  { value: "calm", label: "Calm" },
  { value: "agitated", label: "Agitated" },
  { value: "confused", label: "Confused" },
  { value: "distressed", label: "Distressed" },
  { value: "not_found", label: "Not found" },
  { value: "refused", label: "Refused" },
];

export type HelpedWith = "toileting_assisted" | "hydration_offered" | "repositioned";

export const FLOOR_HELPED_WITH_OPTIONS: ReadonlyArray<ChipOption<HelpedWith>> = [
  { value: "toileting_assisted", label: "Toileting" },
  { value: "hydration_offered", label: "Offered fluids" },
  { value: "repositioned", label: "Repositioned" },
];

export type AnythingWrong =
  | "pain_concern"
  | "breathing_concern"
  | "skin_concern_observed"
  | "fall_hazard_observed"
  | "refused_assistance";

export const FLOOR_ANYTHING_WRONG_OPTIONS: ReadonlyArray<ChipOption<AnythingWrong>> = [
  { value: "pain_concern", label: "Pain" },
  { value: "breathing_concern", label: "Breathing" },
  { value: "skin_concern_observed", label: "Skin" },
  { value: "fall_hazard_observed", label: "Fall hazard" },
  { value: "refused_assistance", label: "Refused help" },
];

export type FloorCheckDraft = {
  quickStatus: ObservationQuickStatus | null;
  /** An `observation_vocab` location code. */
  location: string | null;
  helpedWith: HelpedWith[];
  anythingWrong: AnythingWrong[];
  lateReason: string;
};

export function emptyFloorCheckDraft(): FloorCheckDraft {
  return { quickStatus: null, location: null, helpedWith: [], anythingWrong: [], lateReason: "" };
}

export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** A quick status is the one required pick; the reason is required once the check is over. */
export function floorCheckGaps(draft: FloorCheckDraft, input: { lateReasonRequired: boolean }): string[] {
  const gaps: string[] = [];
  if (!draft.quickStatus) gaps.push("Pick how they are.");
  if (input.lateReasonRequired && !draft.lateReason.trim()) gaps.push("Say why the check is late.");
  return gaps;
}

/**
 * The completion payload, field for field. `distressPresent` and
 * `refusedAssistance` follow the quick status the same way the caregiver
 * capture sets them; "Refused help" also sets `refusedAssistance`.
 */
export function buildFloorCompletionPayload(draft: FloorCheckDraft): CompletionPayload {
  if (!draft.quickStatus) throw new Error("A quick status is required");
  const wrong = new Set(draft.anythingWrong);
  const helped = new Set(draft.helpedWith);
  return {
    quickStatus: draft.quickStatus,
    residentLocation: draft.location,
    toiletingAssisted: helped.has("toileting_assisted"),
    hydrationOffered: helped.has("hydration_offered"),
    repositioned: helped.has("repositioned"),
    painConcern: wrong.has("pain_concern"),
    breathingConcern: wrong.has("breathing_concern"),
    skinConcernObserved: wrong.has("skin_concern_observed"),
    fallHazardObserved: wrong.has("fall_hazard_observed"),
    refusedAssistance: wrong.has("refused_assistance") || draft.quickStatus === "refused",
    distressPresent: draft.quickStatus === "distressed",
    note: null,
    lateReason: draft.lateReason.trim() || null,
  };
}

export type ResidentPronoun = { subject: "she" | "he" | "they"; verb: "is" | "are" };

/**
 * The questions' pronoun comes from the resident record. With no recorded
 * gender (or a gender that does not say she or he) the questions stay neutral:
 * the tablet never guesses.
 */
export function residentPronoun(gender: string | null | undefined): ResidentPronoun {
  if (gender === "female") return { subject: "she", verb: "is" };
  if (gender === "male") return { subject: "he", verb: "is" };
  return { subject: "they", verb: "are" };
}

/** "How is she?", "Where are they?". */
export function checkQuestion(kind: "how" | "where", pronoun: ResidentPronoun): string {
  return `${kind === "how" ? "How" : "Where"} ${pronoun.verb} ${pronoun.subject}?`;
}
