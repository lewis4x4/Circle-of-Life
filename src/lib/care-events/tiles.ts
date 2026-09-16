/**
 * The eight "Something happened" tiles and their question rows (spec 07A §2.1).
 * Pure data so the UI, receipts, and push bodies never hardcode tile words or
 * button text. Option values are the contract codes; labels are the exact
 * spec button texts.
 */

import type { CareEventKind } from "./level-engine";

export type CareEventQuestionOption = { value: string; label: string };

export type CareEventQuestion = {
  key: string;
  prompt: string;
  multi: boolean;
  options: CareEventQuestionOption[];
};

export type CareEventTile = {
  kind: CareEventKind;
  word: string;
  description: string;
  residentOptional: boolean;
  questions: CareEventQuestion[];
};

const YES_NO: CareEventQuestionOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const NO_YES: CareEventQuestionOption[] = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

export const CARE_EVENT_TILES: readonly CareEventTile[] = [
  {
    kind: "fall",
    word: "Fall",
    description: "Found on the floor, slipped, or fell.",
    residentOptional: false,
    questions: [
      {
        key: "hurt",
        prompt: "Are they hurt?",
        multi: false,
        options: [
          { value: "not_hurt", label: "Not hurt" },
          { value: "a_little", label: "A little (bruise, scrape, sore)" },
          {
            value: "badly",
            label:
              "Badly (bleeding will not stop, cannot move or stand, bone looks wrong, passed out)",
          },
        ],
      },
      {
        key: "head",
        prompt: "Did they hit their head?",
        multi: false,
        options: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
          { value: "not_sure", label: "Not sure" },
        ],
      },
      {
        key: "witnessed",
        prompt: "Did anyone see it happen?",
        multi: false,
        options: YES_NO,
      },
      {
        key: "going_out",
        prompt: "Are they going out (911 called or going to the ER)?",
        multi: false,
        options: NO_YES,
      },
    ],
  },
  {
    kind: "injury_found",
    word: "Hurt",
    description: "An injury found, no fall seen.",
    residentOptional: false,
    questions: [
      {
        key: "seen",
        prompt: "What do you see?",
        multi: true,
        options: [
          { value: "bruise", label: "Bruise" },
          { value: "skin_tear", label: "Skin tear or cut" },
          { value: "burn", label: "Burn" },
          { value: "swelling_pain", label: "Swelling or pain" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "care",
        prompt: "How bad?",
        multi: false,
        options: [
          { value: "first_aid_enough", label: "First aid was enough" },
          { value: "more_than_first_aid", label: "Needs more than first aid" },
        ],
      },
      {
        key: "cause_known",
        prompt: "Do you know how it happened?",
        multi: false,
        options: YES_NO,
      },
    ],
  },
  {
    kind: "condition_change",
    word: "Sick or not themselves",
    description: "A change in how they look, act, or feel.",
    residentOptional: false,
    questions: [
      {
        key: "signs",
        prompt: "What do you see?",
        multi: true,
        options: [
          { value: "confused", label: "More confused than usual" },
          { value: "weak_dizzy", label: "Weak or dizzy" },
          { value: "fever_chills", label: "Fever or chills" },
          { value: "vomiting_diarrhea", label: "Vomiting or diarrhea" },
          { value: "not_eating_drinking", label: "Not eating or drinking" },
          { value: "pain", label: "Pain" },
          { value: "short_of_breath", label: "Short of breath" },
          { value: "chest_pain", label: "Chest pain" },
          { value: "stroke_signs", label: "Face droop, slurred speech, one weak side" },
          { value: "wont_wake", label: "Will not wake up or very hard to wake" },
        ],
      },
      {
        key: "onset",
        prompt: "How fast?",
        multi: false,
        options: [
          { value: "today", label: "Came on today" },
          { value: "over_days", label: "Getting worse over days" },
        ],
      },
    ],
  },
  {
    kind: "behavior",
    word: "Upset or behavior",
    description: "Yelling, refusing, hitting, withdrawn, or hurting themselves.",
    residentOptional: false,
    questions: [
      {
        key: "what",
        prompt: "What happened?",
        multi: false,
        options: [
          { value: "yelling", label: "Yelling or cursing" },
          { value: "refusing_care", label: "Refusing care" },
          { value: "hitting", label: "Hitting, pushing, grabbing" },
          { value: "sexual", label: "Sexual behavior" },
          { value: "crying_withdrawn", label: "Crying or withdrawn" },
          { value: "self_harm", label: "Hurting themselves" },
        ],
      },
      {
        key: "touched",
        prompt: "Was anyone touched or hurt?",
        multi: false,
        options: [
          { value: "no_one", label: "No one" },
          { value: "another_resident", label: "Another resident" },
          { value: "staff", label: "Staff" },
        ],
      },
      {
        key: "over",
        prompt: "Is it over?",
        multi: false,
        options: [
          { value: "yes", label: "Yes" },
          { value: "still_going", label: "Still going" },
        ],
      },
    ],
  },
  {
    kind: "wandering",
    word: "Wandering or left",
    description: "Out of their area, outside, or missing.",
    residentOptional: false,
    questions: [
      {
        key: "where",
        prompt: "Where are they now?",
        multi: false,
        options: [
          { value: "found_inside", label: "Found inside" },
          { value: "found_grounds", label: "Found outside on the grounds" },
          { value: "found_off_property", label: "Found off the property" },
          { value: "not_found", label: "Not found yet" },
        ],
      },
      {
        key: "hurt",
        prompt: "Hurt?",
        multi: false,
        options: NO_YES,
      },
    ],
  },
  {
    kind: "medication",
    word: "Medicine",
    description: "Refused, missed, wrong, or a reaction.",
    residentOptional: false,
    questions: [
      {
        key: "what",
        prompt: "What happened?",
        multi: false,
        options: [
          { value: "refused", label: "Refused" },
          { value: "missed_late", label: "Missed or late" },
          { value: "wrong", label: "Wrong medicine, dose, time, or person" },
          { value: "not_theirs", label: "Took something not theirs" },
        ],
      },
      {
        key: "reaction",
        prompt: "Any reaction or feeling bad?",
        multi: false,
        options: NO_YES,
      },
    ],
  },
  {
    kind: "family_complaint",
    word: "Family or complaint",
    description: "A family concern, visitor problem, complaint, or possible mistreatment.",
    residentOptional: false,
    questions: [
      {
        key: "what",
        prompt: "What happened?",
        multi: false,
        options: [
          { value: "family_upset", label: "Family upset or complaint" },
          { value: "visitor_problem", label: "Visitor problem" },
          { value: "resident_complaint", label: "Resident complaint about care" },
          { value: "mistreated", label: "Someone may have been mistreated" },
        ],
      },
    ],
  },
  {
    kind: "environment",
    word: "Building or other",
    description: "Leak, fire, power, equipment, or anything else.",
    residentOptional: true,
    questions: [
      {
        key: "what",
        prompt: "What happened?",
        multi: false,
        options: [
          { value: "water_leak", label: "Water leak or flood" },
          { value: "smoke_fire", label: "Smoke, fire, or alarm" },
          { value: "power_out", label: "Power out" },
          { value: "broken_equipment", label: "Broken equipment" },
          { value: "missing_damaged", label: "Something missing or damaged" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "danger",
        prompt: "Is anyone in danger?",
        multi: false,
        options: NO_YES,
      },
    ],
  },
];

export function careEventTileByKind(kind: CareEventKind): CareEventTile {
  const tile = CARE_EVENT_TILES.find((candidate) => candidate.kind === kind);
  if (!tile) {
    throw new Error(`Unknown care event kind: ${String(kind)}`);
  }
  return tile;
}

/** The tile word, for push bodies and receipts. */
export function careEventTileWord(kind: CareEventKind): string {
  return careEventTileByKind(kind).word;
}
