/**
 * "Chart a check" on the floor tablet (spec 40 §6 screen 5, DESIGN.md 05):
 * the rounding completion payload as chips. Every chip maps onto one existing
 * `CompletionPayload` field; nothing here is a new kind of answer.
 *
 * A Smart Rounding check (cadence or monitoring order) is refused by
 * `haven.require_observation_capture` without where they were, what they were
 * doing and at least one meal, mood or medication chip, so the tablet asks for
 * all three from `observation_vocab`, the same vocabulary the caregiver capture
 * uses. The payload is marked `captureSurface: "floor"`: the route and the
 * device replay both write it through `complete_rounding_task_review`, which
 * keeps the flat answers below alongside the chips.
 */

import { selectLocationChips, type LocationVocabRow } from "@/lib/care-events/report-data";
import {
  OBSERVATION_CHIP_GROUPS,
  countObservationChips,
  emptyObservationVocabCatalog,
  normalizeObservationChips,
  type ObservationChipSelections,
  type ObservationVocabCatalog,
  type ObservationVocabOption,
} from "@/lib/rounding/observation-chips";
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
  /** An `observation_vocab` state code: what they were doing. */
  residentState: string | null;
  /** Meal, mood and medication chips, `observation_vocab` codes by group. */
  chips: ObservationChipSelections;
  helpedWith: HelpedWith[];
  anythingWrong: AnythingWrong[];
  lateReason: string;
};

export function emptyFloorCheckDraft(): FloorCheckDraft {
  return { quickStatus: null, location: null, residentState: null, chips: {}, helpedWith: [], anythingWrong: [], lateReason: "" };
}

export type FloorVocabRow = LocationVocabRow & { field_name: string };

/** The `observation_vocab` fields the check reads. */
export const FLOOR_CHECK_VOCAB_FIELDS = ["location", "state", ...OBSERVATION_CHIP_GROUPS] as const;

/**
 * The facility's choices for the check. Places are the in-building ones the
 * report flow offers; every other field lists each code once, the facility's
 * own row winning over the organization's, in display order.
 */
export function floorCheckVocabFromRows(rows: readonly FloorVocabRow[], facilityId: string): ObservationVocabCatalog {
  const catalog = emptyObservationVocabCatalog();
  const inScope = rows.filter((row) => row.facility_id === facilityId || row.facility_id === null);
  catalog.location = selectLocationChips(inScope.filter((row) => row.field_name === "location"), facilityId);
  for (const field of ["state", ...OBSERVATION_CHIP_GROUPS] as const) {
    const byCode = new Map<string, FloorVocabRow>();
    for (const row of inScope) {
      if (row.field_name !== field) continue;
      const seen = byCode.get(row.value_code);
      if (!seen || (seen.facility_id === null && row.facility_id === facilityId)) byCode.set(row.value_code, row);
    }
    catalog[field] = [...byCode.values()]
      .sort((a, b) => a.display_order - b.display_order || a.display_label.localeCompare(b.display_label))
      .map((row): ObservationVocabOption => ({ code: row.value_code, label: row.display_label }));
  }
  return catalog;
}

export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/**
 * How they are, where they are, what they are doing and at least one meal,
 * mood or medication chip are required, as on the caregiver capture; the
 * reason is required once the check is over.
 */
export function floorCheckGaps(draft: FloorCheckDraft, input: { lateReasonRequired: boolean }): string[] {
  const gaps: string[] = [];
  if (!draft.quickStatus) gaps.push("Pick how they are.");
  if (!draft.location?.trim()) gaps.push("Pick where they are.");
  if (!draft.residentState?.trim()) gaps.push("Pick what they are doing.");
  if (countObservationChips(draft.chips) === 0) gaps.push("Pick at least one for meals, mood or medications.");
  if (input.lateReasonRequired && !draft.lateReason.trim()) gaps.push("Say why the check is late.");
  return gaps;
}

/**
 * The completion payload, field for field. `distressPresent` and
 * `refusedAssistance` follow the quick status the same way the caregiver
 * capture sets them; "Refused help" also sets `refusedAssistance`. Chips are
 * ordered by the vocabulary, as the caregiver capture sends them.
 */
export function buildFloorCompletionPayload(draft: FloorCheckDraft, vocab: ObservationVocabCatalog): CompletionPayload {
  if (!draft.quickStatus) throw new Error("A quick status is required");
  const wrong = new Set(draft.anythingWrong);
  const helped = new Set(draft.helpedWith);
  return {
    captureSurface: "floor",
    quickStatus: draft.quickStatus,
    residentLocation: draft.location,
    residentState: draft.residentState,
    chipSelections: normalizeObservationChips(draft.chips, vocab) as Record<string, string[]>,
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

/** "How is she?", "Where are they?", "What is he doing?". */
export function checkQuestion(kind: "how" | "where" | "doing", pronoun: ResidentPronoun): string {
  if (kind === "doing") return `What ${pronoun.verb} ${pronoun.subject} doing?`;
  return `${kind === "how" ? "How" : "Where"} ${pronoun.verb} ${pronoun.subject}?`;
}
