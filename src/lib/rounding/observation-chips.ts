import type { ObservationQuickStatus } from "@/lib/rounding/types";

/**
 * Chip capture vocabulary and the sentence it composes.
 *
 * The stored sentence is always the one migration 413 composes on the server.
 * Everything here exists so the caregiver can read that sentence back before
 * they submit, and so the "chips required, note optional" rule is testable
 * without a database. The order and punctuation below mirror
 * `haven.compose_observation_summary` exactly; change one and change both.
 */

export const OBSERVATION_CHIP_GROUPS = ["meal_intake", "mood_state", "med_response"] as const;

export type ObservationChipGroup = (typeof OBSERVATION_CHIP_GROUPS)[number];

/** Operator wording for each chip row. The group key itself never renders. */
export const OBSERVATION_CHIP_GROUP_HEADINGS: Record<ObservationChipGroup, string> = {
  meal_intake: "Meals",
  mood_state: "Mood",
  med_response: "Medications",
};

export type ObservationVocabOption = {
  code: string;
  label: string;
};

export type ObservationVocabCatalog = {
  location: ObservationVocabOption[];
  position: ObservationVocabOption[];
  state: ObservationVocabOption[];
  meal_intake: ObservationVocabOption[];
  mood_state: ObservationVocabOption[];
  med_response: ObservationVocabOption[];
};

export type ObservationChipSelections = Partial<Record<ObservationChipGroup, string[]>>;

const QUICK_STATUS_LABELS: Record<ObservationQuickStatus, string> = {
  awake: "Awake",
  asleep: "Asleep",
  calm: "Calm",
  agitated: "Agitated",
  confused: "Confused",
  distressed: "Distressed",
  not_found: "Not found",
  refused: "Declined the check",
};

export const OBSERVATION_QUICK_STATUS_OPTIONS: ObservationVocabOption[] = (
  Object.keys(QUICK_STATUS_LABELS) as ObservationQuickStatus[]
).map((code) => ({ code, label: QUICK_STATUS_LABELS[code] }));

export function describeObservationQuickStatus(status: ObservationQuickStatus | string | null | undefined) {
  if (!status) return null;
  return QUICK_STATUS_LABELS[status as ObservationQuickStatus] ?? null;
}

export function emptyObservationVocabCatalog(): ObservationVocabCatalog {
  return { location: [], position: [], state: [], meal_intake: [], mood_state: [], med_response: [] };
}

export function countObservationChips(selections: ObservationChipSelections) {
  return OBSERVATION_CHIP_GROUPS.reduce((total, group) => total + (selections[group]?.length ?? 0), 0);
}

export function isObservationChipSelected(
  selections: ObservationChipSelections,
  group: ObservationChipGroup,
  code: string,
) {
  return (selections[group] ?? []).includes(code);
}

/** Pure toggle. An empty group is removed rather than left as an empty list. */
export function toggleObservationChip(
  selections: ObservationChipSelections,
  group: ObservationChipGroup,
  code: string,
): ObservationChipSelections {
  const current = selections[group] ?? [];
  const next = current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code];
  const result: ObservationChipSelections = { ...selections };
  if (next.length === 0) {
    delete result[group];
    return result;
  }
  result[group] = next;
  return result;
}

/**
 * Orders each group by the vocabulary and drops duplicates.
 *
 * A code the catalog does not know is kept, at the end, deliberately. The
 * submit command refuses an unknown code rather than dropping it, and a chip
 * the caregiver tapped must never disappear on the way to the server without
 * anyone being told.
 */
export function normalizeObservationChips(
  selections: ObservationChipSelections,
  catalog: ObservationVocabCatalog,
): ObservationChipSelections {
  const result: ObservationChipSelections = {};
  for (const group of OBSERVATION_CHIP_GROUPS) {
    const selected = new Set(selections[group] ?? []);
    const known = catalog[group].filter((option) => selected.has(option.code)).map((option) => option.code);
    const unknown = [...selected].filter((code) => !known.includes(code));
    const ordered = [...known, ...unknown];
    if (ordered.length > 0) result[group] = ordered;
  }
  return result;
}

export type ObservationDraft = {
  quickStatus: ObservationQuickStatus | null;
  residentLocation: string | null;
  residentState: string | null;
  residentPosition?: string | null;
  chipSelections: ObservationChipSelections;
  /** Present for completeness. It is never read by the submittable rule. */
  note?: string | null;
};

/**
 * Chips required, note optional. The note is deliberately absent from this
 * rule: no observation is ever refused, flagged or nagged for missing prose.
 */
export function isObservationSubmittable(draft: ObservationDraft) {
  if (!draft.quickStatus) return false;
  if (!draft.residentLocation?.trim()) return false;
  if (!draft.residentState?.trim()) return false;
  return countObservationChips(draft.chipSelections) > 0;
}

/** What is still missing, in operator words. Never mentions the note. */
export function describeObservationGaps(draft: ObservationDraft): string[] {
  const gaps: string[] = [];
  if (!draft.residentLocation?.trim()) gaps.push("where they were");
  if (!draft.residentState?.trim()) gaps.push("how they presented");
  if (!draft.quickStatus) gaps.push("their status");
  if (countObservationChips(draft.chipSelections) === 0) gaps.push("a meal, mood or medication chip");
  return gaps;
}

function labelFor(options: ObservationVocabOption[], code: string | null | undefined) {
  if (!code) return null;
  const match = options.find((option) => option.code === code);
  if (match) return match.label;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uncapitalize(label: string) {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function clause(segments: string[]) {
  return segments.length > 0 ? `${segments.join(", ")}.` : null;
}

/**
 * Preview only. The stored sentence is whatever the submit command composes.
 * The capture surface records no interventions, so the fourth clause the
 * server can compose never appears here.
 */
export function composeObservationPreview(draft: ObservationDraft, catalog: ObservationVocabCatalog): string {
  const chipSegments: string[] = [];
  for (const group of OBSERVATION_CHIP_GROUPS) {
    for (const option of catalog[group]) {
      if (!(draft.chipSelections[group] ?? []).includes(option.code)) continue;
      chipSegments.push(chipSegments.length === 0 ? option.label : uncapitalize(option.label));
    }
  }

  const presentation: string[] = [];
  const status = describeObservationQuickStatus(draft.quickStatus);
  if (status) presentation.push(status);
  const state = labelFor(catalog.state, draft.residentState);
  if (state) presentation.push(state);

  const place: string[] = [];
  const location = labelFor(catalog.location, draft.residentLocation);
  if (location) place.push(`In ${location.replace(/^[Ii]n +/, "")}`);
  const position = labelFor(catalog.position, draft.residentPosition);
  if (position) place.push(position);

  const clauses = [clause(chipSegments), clause(presentation), clause(place)].filter(
    (entry): entry is string => Boolean(entry),
  );

  return clauses.length > 0 ? clauses.join(" ") : "Check recorded with no details captured.";
}
