/**
 * "Something happened" level engine (TypeScript runtime).
 *
 * Binding contract: docs/specs/07A-level-engine-contract.md. The SQL mirror
 * `public.care_event_derive` implements the same rules and the parity script
 * diffs every case in `level-cases.json` across both runtimes, so any change
 * here must land in the contract and the SQL function too.
 *
 * Pure: no IO, no database, no Date. Callers pass display labels in `context`.
 */

export const CARE_EVENT_KINDS = [
  "fall",
  "injury_found",
  "condition_change",
  "behavior",
  "wandering",
  "medication",
  "family_complaint",
  "environment",
] as const;

export type CareEventKind = (typeof CARE_EVENT_KINDS)[number];

export function isCareEventKind(value: unknown): value is CareEventKind {
  return typeof value === "string" && (CARE_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Flat answer object (contract §2). Single-select values are strings and
 * multi-select values are string arrays. Unknown or missing values apply no rule.
 */
export type CareEventAnswers = {
  /** fall: not_hurt | a_little | badly. wandering: no | yes. */
  hurt?: string;
  /** fall: no | yes | not_sure */
  head?: string;
  /** fall: yes | no */
  witnessed?: string;
  /** fall: no | yes */
  going_out?: string;
  /** injury_found (multi): bruise | skin_tear | burn | swelling_pain | other */
  seen?: string[];
  /** injury_found: first_aid_enough | more_than_first_aid */
  care?: string;
  /** injury_found: yes | no */
  cause_known?: string;
  /** condition_change (multi): see contract §2 */
  signs?: string[];
  /** condition_change: today | over_days */
  onset?: string;
  /** behavior, medication, family_complaint, environment: see contract §2 */
  what?: string;
  /** behavior: no_one | another_resident | staff */
  touched?: string;
  /** behavior: yes | still_going */
  over?: string;
  /** wandering: found_inside | found_grounds | found_off_property | not_found */
  where?: string;
  /** medication: no | yes */
  reaction?: string;
  /** environment: no | yes */
  danger?: string;
  /** Reporter bump (all kinds). Absent means false. */
  worried?: boolean;
};

/** Resident and capture context (contract §3). Missing keys default to false / null. */
export type CareEventContext = {
  active_watch?: boolean;
  elopement_risk?: boolean;
  prior_unexplained_bruise_30d?: boolean;
  location_label?: string | null;
  time_label?: string | null;
};

export type CareEventFlags = {
  ahca_reportable: boolean;
  insurance_reportable: boolean;
  dcf_report_required: boolean;
  grievance_clock: boolean;
  neuro_checks: boolean;
  call_911_prompt: boolean;
  photo_prompt: boolean;
  emar_reminder: boolean;
};

export type CareEventLevel = 1 | 2 | 3 | 4;

export type CareEventDerivation = {
  /** Final level after the reporter bump and clamp (stored as `final_level`). */
  level: CareEventLevel;
  /** Level before the reporter bump (stored as `derived_level`). */
  derived_level: CareEventLevel;
  /** `incident_category` enum value as text. */
  category: string;
  flags: CareEventFlags;
  /** Section 1 factual sentence built from the answers. */
  sentence: string;
};

export function emptyCareEventFlags(): CareEventFlags {
  return {
    ahca_reportable: false,
    insurance_reportable: false,
    dcf_report_required: false,
    grievance_clock: false,
    neuro_checks: false,
    call_911_prompt: false,
    photo_prompt: false,
    emar_reminder: false,
  };
}

const BASE_LEVEL: Record<CareEventKind, number> = {
  fall: 2,
  injury_found: 1,
  condition_change: 2,
  behavior: 1,
  wandering: 1,
  medication: 1,
  family_complaint: 1,
  environment: 1,
};

/** Multi-select labels in display order (contract §7). */
const SEEN_LABELS: readonly [string, string][] = [
  ["bruise", "bruise"],
  ["skin_tear", "skin tear or cut"],
  ["burn", "burn"],
  ["swelling_pain", "swelling or pain"],
  ["other", "other"],
];

const SIGN_LABELS: readonly [string, string][] = [
  ["confused", "more confused than usual"],
  ["weak_dizzy", "weak or dizzy"],
  ["fever_chills", "fever or chills"],
  ["vomiting_diarrhea", "vomiting or diarrhea"],
  ["not_eating_drinking", "not eating or drinking"],
  ["pain", "pain"],
  ["short_of_breath", "short of breath"],
  ["chest_pain", "chest pain"],
  ["stroke_signs", "face droop, slurred speech, or one weak side"],
  ["wont_wake", "will not wake up or very hard to wake"],
];

const LEVEL_4_SIGNS: readonly string[] = ["short_of_breath", "chest_pain", "stroke_signs", "wont_wake"];

const SKIN_INTEGRITY_SEEN: readonly string[] = ["bruise", "skin_tear", "burn", "swelling_pain"];

const ALLEGATION_CATEGORIES: readonly string[] = ["abuse_allegation", "neglect_allegation"];

const AHCA_LEVEL_4_KINDS: readonly CareEventKind[] = [
  "fall",
  "condition_change",
  "wandering",
  "medication",
  "environment",
];

/** Kinds whose Level 4 shows the "Call 911 first" line (contract §6). */
export const CARE_EVENT_CALL_911_KINDS: readonly CareEventKind[] = [
  "fall",
  "condition_change",
  "wandering",
  "environment",
];

function clampLevel(value: number): CareEventLevel {
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  return value as CareEventLevel;
}

function multi(value: string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

function includesAny(list: readonly string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => list.includes(candidate));
}

/** Contract §4 steps 1 to 2: base level by kind, then answer rules. */
function answerLevel(kind: CareEventKind, answers: CareEventAnswers): number {
  let level = BASE_LEVEL[kind];
  const raise = (rule: number) => {
    level = Math.max(level, rule);
  };

  switch (kind) {
    case "fall": {
      if (answers.hurt === "badly") raise(4);
      if (answers.hurt === "a_little") raise(2);
      if (answers.head === "yes" || answers.head === "not_sure") raise(3);
      if (answers.going_out === "yes") raise(4);
      break;
    }
    case "injury_found": {
      if (answers.care === "more_than_first_aid") raise(3);
      if (answers.cause_known === "no") raise(2);
      break;
    }
    case "condition_change": {
      const signs = multi(answers.signs);
      const known = SIGN_LABELS.filter(([code]) => signs.includes(code));
      if (includesAny(signs, LEVEL_4_SIGNS)) raise(4);
      else if (known.length >= 2) raise(3);
      else if (known.length === 1) raise(2);
      break;
    }
    case "behavior": {
      if (answers.what === "self_harm") raise(3);
      if (answers.touched === "another_resident") raise(3);
      if (answers.touched === "staff") raise(2);
      if (answers.over === "still_going") raise(2);
      break;
    }
    case "wandering": {
      if (answers.where === "found_inside") raise(1);
      if (answers.where === "found_grounds") raise(2);
      if (answers.where === "found_off_property") raise(3);
      if (answers.where === "not_found") raise(4);
      if (answers.hurt === "yes") level += 1;
      break;
    }
    case "medication": {
      if (answers.what === "refused") raise(1);
      if (answers.what === "missed_late") raise(2);
      if (answers.what === "wrong" || answers.what === "not_theirs") raise(3);
      if (answers.reaction === "yes") raise(4);
      break;
    }
    case "family_complaint": {
      if (answers.what === "mistreated") raise(3);
      if (answers.what === "resident_complaint") raise(2);
      break;
    }
    case "environment": {
      if (answers.what === "smoke_fire") raise(4);
      if (answers.what === "water_leak" || answers.what === "power_out") raise(2);
      if (answers.danger === "yes") raise(4);
      break;
    }
  }

  return level;
}

/** Contract §4 step 3: resident context raises. */
function contextLevel(
  kind: CareEventKind,
  answers: CareEventAnswers,
  context: CareEventContext,
  level: number,
): number {
  let next = level;
  if (context.active_watch === true && (kind === "fall" || kind === "condition_change")) next += 1;
  if (context.elopement_risk === true && kind === "wandering") next += 1;
  if (
    context.prior_unexplained_bruise_30d === true &&
    kind === "injury_found" &&
    answers.cause_known === "no" &&
    multi(answers.seen).includes("bruise")
  ) {
    next = Math.max(next, 3);
  }
  return next;
}

/** Contract §5. */
function deriveCategory(kind: CareEventKind, answers: CareEventAnswers): string {
  switch (kind) {
    case "fall":
      return answers.hurt === "a_little" || answers.hurt === "badly"
        ? "fall_with_injury"
        : "fall_without_injury";
    case "injury_found": {
      const seen = multi(answers.seen);
      if (answers.cause_known === "no" && seen.includes("bruise")) return "unexplained_bruise";
      if (includesAny(seen, SKIN_INTEGRITY_SEEN)) return "skin_integrity";
      return "other";
    }
    case "condition_change":
      return "other";
    case "behavior":
      if (answers.what === "self_harm") return "behavioral_self_harm";
      if (answers.touched === "another_resident") return "behavioral_resident_to_resident";
      if (answers.touched === "staff") return "behavioral_resident_to_staff";
      return "other";
    case "wandering":
      return answers.where === "found_off_property" || answers.where === "not_found"
        ? "elopement"
        : "wandering";
    case "medication":
      return answers.what === "refused" ? "medication_refusal" : "medication_error";
    case "family_complaint":
      return answers.what === "mistreated" ? "abuse_allegation" : "other";
    case "environment":
      switch (answers.what) {
        case "smoke_fire":
          return "environmental_fire";
        case "water_leak":
          return "environmental_flood";
        case "power_out":
          return "environmental_power";
        case "broken_equipment":
          return "property_damage";
        case "missing_damaged":
          return "property_loss";
        default:
          return "other";
      }
  }
}

/** Contract §6, computed from the final level and the category. */
function deriveFlags(
  kind: CareEventKind,
  answers: CareEventAnswers,
  level: CareEventLevel,
  category: string,
): CareEventFlags {
  const allegation = ALLEGATION_CATEGORIES.includes(category);
  return {
    ahca_reportable:
      (level === 4 && AHCA_LEVEL_4_KINDS.includes(kind)) ||
      allegation ||
      (kind === "fall" && answers.going_out === "yes"),
    insurance_reportable: level >= 3 || category === "elopement" || allegation,
    dcf_report_required: allegation,
    grievance_clock: kind === "family_complaint" && answers.what === "resident_complaint",
    neuro_checks: kind === "fall" && (answers.head === "yes" || answers.head === "not_sure"),
    call_911_prompt: level === 4 && CARE_EVENT_CALL_911_KINDS.includes(kind),
    photo_prompt: kind === "injury_found" && level === 1,
    emar_reminder: kind === "medication" && answers.what === "refused",
  };
}

function pick(value: string | undefined, table: Record<string, string>): string | null {
  if (value === undefined) return null;
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null;
}

function listFragment(
  prefix: string,
  selected: readonly string[],
  labels: readonly [string, string][],
): string | null {
  const parts = labels.filter(([code]) => selected.includes(code)).map(([, label]) => label);
  if (parts.length === 0) return null;
  return `${prefix}${parts.join(", ")}.`;
}

/** Contract §7. */
function deriveSentence(kind: CareEventKind, answers: CareEventAnswers, context: CareEventContext): string {
  const location = context.location_label ? ` in the ${context.location_label.toLowerCase()}` : "";
  const time = context.time_label ? ` at ${context.time_label}` : "";
  const opener = (lead: string) => `${lead}${location}${time}.`;

  const fragments: (string | null)[] = [];

  switch (kind) {
    case "fall":
      fragments.push(
        opener("Found on the floor"),
        pick(answers.witnessed, { yes: "Witnessed.", no: "Not witnessed." }),
        pick(answers.hurt, { not_hurt: "Not hurt.", a_little: "Hurt a little.", badly: "Hurt badly." }),
        pick(answers.head, {
          no: "Did not hit head.",
          yes: "Hit head.",
          not_sure: "Not sure if head was hit.",
        }),
        pick(answers.going_out, { no: "Not going out.", yes: "Going out to the ER or 911 called." }),
        pick(answers.hurt, { a_little: "First aid given.", badly: "Emergency care requested." }),
      );
      break;
    case "injury_found":
      fragments.push(
        opener("Injury found"),
        listFragment("Seen: ", multi(answers.seen), SEEN_LABELS),
        pick(answers.care, {
          first_aid_enough: "First aid was enough.",
          more_than_first_aid: "Needs more than first aid.",
        }),
        pick(answers.cause_known, { yes: "Cause known.", no: "Cause unknown." }),
      );
      break;
    case "condition_change":
      fragments.push(
        opener("Not themselves"),
        listFragment("Signs: ", multi(answers.signs), SIGN_LABELS),
        pick(answers.onset, { today: "Came on today.", over_days: "Getting worse over days." }),
      );
      break;
    case "behavior":
      fragments.push(
        opener("Behavior"),
        pick(answers.what, {
          yelling: "Yelling or cursing.",
          refusing_care: "Refusing care.",
          hitting: "Hitting, pushing, or grabbing.",
          sexual: "Sexual behavior.",
          crying_withdrawn: "Crying or withdrawn.",
          self_harm: "Hurting themselves.",
        }),
        pick(answers.touched, {
          no_one: "No one touched or hurt.",
          another_resident: "Another resident touched or hurt.",
          staff: "Staff touched or hurt.",
        }),
        pick(answers.over, { yes: "It is over.", still_going: "Still going." }),
      );
      break;
    case "wandering":
      fragments.push(
        opener("Wandering"),
        pick(answers.where, {
          found_inside: "Found inside.",
          found_grounds: "Found outside on the grounds.",
          found_off_property: "Found off the property.",
          not_found: "Not found yet.",
        }),
        pick(answers.hurt, { no: "Not hurt.", yes: "Hurt." }),
      );
      break;
    case "medication":
      fragments.push(
        opener("Medicine"),
        pick(answers.what, {
          refused: "Refused.",
          missed_late: "Missed or late.",
          wrong: "Wrong medicine, dose, time, or person.",
          not_theirs: "Took something not theirs.",
        }),
        pick(answers.reaction, { no: "No reaction.", yes: "Reaction or feeling bad." }),
      );
      break;
    case "family_complaint":
      fragments.push(
        opener("Family or complaint"),
        pick(answers.what, {
          family_upset: "Family upset or complaint.",
          visitor_problem: "Visitor problem.",
          resident_complaint: "Resident complaint about care.",
          mistreated: "Someone may have been mistreated.",
        }),
      );
      break;
    case "environment":
      fragments.push(
        opener("Building"),
        pick(answers.what, {
          water_leak: "Water leak or flood.",
          smoke_fire: "Smoke, fire, or alarm.",
          power_out: "Power out.",
          broken_equipment: "Broken equipment.",
          missing_damaged: "Something missing or damaged.",
          other: "Other.",
        }),
        pick(answers.danger, { no: "No one in danger.", yes: "Someone in danger." }),
      );
      break;
  }

  return fragments.filter((fragment): fragment is string => fragment !== null).join(" ");
}

/**
 * Derive level, category, flags, and the factual sentence for a care event.
 * Throws on an unknown kind. Unknown answer values apply no rule.
 */
export function deriveCareEvent(
  kind: string,
  answers: CareEventAnswers,
  context: CareEventContext = {},
): CareEventDerivation {
  if (!isCareEventKind(kind)) {
    throw new Error(`Unknown care event kind: ${String(kind)}`);
  }

  const derivedLevel = clampLevel(contextLevel(kind, answers, context, answerLevel(kind, answers)));
  const level = answers.worried === true ? clampLevel(derivedLevel + 1) : derivedLevel;
  const category = deriveCategory(kind, answers);

  return {
    level,
    derived_level: derivedLevel,
    category,
    flags: deriveFlags(kind, answers, level, category),
    sentence: deriveSentence(kind, answers, context),
  };
}
