/**
 * Draft care-plan lines from a resident's current Form 1823.
 *
 * The 1823 is the physician's assessment; the care plan is the facility's
 * answer to it. This turns the structured April-2021 form (form_1823_records,
 * migration 386) into editor lines the nurse then edits, saves for review, and
 * signs. Every judgment the form leaves open is returned as a gap, not guessed.
 * Pure: no I/O, so the mapping is testable line by line.
 */

import { formatCarePlanDateOnly } from "./care-plan-display-copy";

export type Form1823DraftSource = {
  id: string;
  exam_date: string | null;
  physician_name: string | null;
  examiner_title: string | null;
  allergies: string[] | null;
  prescribed_diet: string | null;
  medication_assistance: string | null;
  elopement_risk: boolean | null;
  adl_bathing: string | null;
  adl_dressing: string | null;
  adl_eating: string | null;
  adl_transferring: string | null;
  adl_toileting: string | null;
  adl_grooming: string | null;
  adl_walking: string | null;
  condition_pressure_injury: boolean | null;
  physical_limitations: unknown;
  cognitive_behavioral_status: unknown;
  service_requirements: unknown;
  precautions: unknown;
};

export type CarePlanDraftItem = {
  category: string;
  title: string;
  description: string;
  assistance_level: string;
  frequency: string;
  goal: string;
  interventions: string[];
  special_instructions: string;
};

export type CarePlanDraftGap = {
  /** The editor line the gap belongs to, when there is one. */
  title: string | null;
  message: string;
};

export type CarePlanDraft = {
  items: CarePlanDraftItem[];
  notes: string;
  effectiveDate: string;
  reviewDueDate: string;
  gaps: CarePlanDraftGap[];
};

export const DEFAULT_REVIEW_MONTHS = 12;

/** Form 1823 column → editor category and line title. Transferring and walking both live under mobility. */
const ADL_LINES: Array<{ column: keyof Form1823DraftSource; category: string; title: string; verb: string }> = [
  { column: "adl_walking", category: "mobility", title: "Ambulation", verb: "walking" },
  { column: "adl_transferring", category: "mobility", title: "Transferring", verb: "transferring" },
  { column: "adl_bathing", category: "bathing", title: "Bathing", verb: "bathing" },
  { column: "adl_dressing", category: "dressing", title: "Dressing", verb: "dressing" },
  { column: "adl_grooming", category: "grooming", title: "Self-care (grooming)", verb: "grooming" },
  { column: "adl_toileting", category: "toileting", title: "Toileting", verb: "toileting" },
  { column: "adl_eating", category: "eating", title: "Eating", verb: "eating" },
];

/**
 * The 1823's four-point scale against Haven's five-point one. "A = Needs
 * Assistance" has no single home: it is drafted as limited_assist and flagged.
 */
const ADL_ASSISTANCE: Record<string, { level: string; label: string; flag: boolean }> = {
  independent: { level: "independent", label: "Independent", flag: false },
  supervision: { level: "supervision", label: "Needs supervision", flag: false },
  assistance: { level: "limited_assist", label: "Needs assistance", flag: true },
  dependent: { level: "total_dependence", label: "Total care", flag: false },
};

/** Flatten a free-form JSON section (intake stores these as bounded objects) into one line of text. */
export function form1823SectionText(value: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) parts.push(trimmed);
    } else if (typeof node === "number" || typeof node === "boolean") {
      parts.push(String(node));
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  return parts.join("; ").slice(0, 500);
}

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp end-of-month overflow (Sep 31 → Sep 30) instead of sliding into the next month.
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function examLabel(source: Form1823DraftSource): string {
  return `Form 1823 exam ${formatCarePlanDateOnly(source.exam_date)}`;
}

export function draftCarePlanFromForm1823(
  source: Form1823DraftSource,
  options: { today: string; reviewMonths?: number },
): CarePlanDraft {
  const items: CarePlanDraftItem[] = [];
  const gaps: CarePlanDraftGap[] = [];
  const exam = examLabel(source);
  const limitations = form1823SectionText(source.physical_limitations);
  const precautions = form1823SectionText(source.precautions);
  const mobilityInstructions = [limitations, precautions].filter(Boolean).join(" · ");

  for (const line of ADL_LINES) {
    const raw = source[line.column];
    const value = typeof raw === "string" ? raw : null;
    const mapped = value ? ADL_ASSISTANCE[value] : undefined;
    if (!mapped) {
      items.push({
        category: line.category,
        title: line.title,
        description: `${line.title} level not assessed on the ${exam}`,
        assistance_level: "",
        frequency: "Each occasion",
        goal: "",
        interventions: [],
        special_instructions: line.category === "mobility" ? mobilityInstructions : "",
      });
      gaps.push({ title: line.title, message: `${line.title}: the 1823 does not assess this; choose the support level.` });
      continue;
    }
    items.push({
      category: line.category,
      title: line.title,
      description: `${mapped.label} with ${line.verb} per the ${exam}`,
      assistance_level: mapped.level,
      frequency: "Each occasion",
      goal: "",
      interventions: [],
      special_instructions: line.category === "mobility" ? mobilityInstructions : "",
    });
    if (mapped.flag) {
      gaps.push({ title: line.title, message: `${line.title}: the 1823 says "needs assistance" — drafted as limited assist; change to extensive assist if staff do most of the task.` });
    }
  }

  switch (source.medication_assistance) {
    case "self_administered":
      items.push({ category: "medication_assistance", title: "Medications", description: `Self-administers medications per the ${exam}`, assistance_level: "independent", frequency: "Per orders", goal: "", interventions: ["Observe for changes in ability to self-administer"], special_instructions: "" });
      break;
    case "assistance_with_self_administration":
      items.push({ category: "medication_assistance", title: "Medications", description: `Needs assistance with self-administration per the ${exam} (§2B)`, assistance_level: "limited_assist", frequency: "Per orders", goal: "", interventions: ["Unlicensed staff assist with self-administration of oral, topical, ophthalmic, otic and nasal medications"], special_instructions: "" });
      break;
    case "administered_by_licensed_staff":
      items.push({ category: "medication_assistance", title: "Medications", description: `Requires medication administration by licensed staff per the ${exam} (§2B)`, assistance_level: "extensive_assist", frequency: "Per orders", goal: "", interventions: ["Licensed staff administer medications"], special_instructions: "" });
      break;
    default:
      gaps.push({ title: null, message: "Medications: the 1823 does not say whether the resident needs help with medications; add a medication line if they do." });
  }

  if (source.elopement_risk === true) {
    items.push({ category: "behavioral", title: "Elopement precautions", description: `Elopement risk marked Yes on the ${exam}`, assistance_level: "supervision", frequency: "Continuous", goal: "Resident remains safely within the facility", interventions: [], special_instructions: "" });
    gaps.push({ title: "Elopement precautions", message: "Elopement precautions: name the interventions in place (door alarms, wander guard, check frequency)." });
  } else if (source.elopement_risk == null) {
    gaps.push({ title: null, message: "Elopement risk is not marked on the 1823." });
  }

  const cognitive = form1823SectionText(source.cognitive_behavioral_status);
  if (cognitive) {
    items.push({ category: "cognitive", title: "Cognitive / behavioral status", description: `${cognitive} (per the ${exam})`, assistance_level: "supervision", frequency: "Each shift", goal: "", interventions: [], special_instructions: "" });
  }

  const diet = (source.prescribed_diet ?? "").trim();
  if (diet) {
    items.push({ category: "dietary", title: `Diet: ${diet}`, description: `Diet ordered on the ${exam}`, assistance_level: "supervision", frequency: "Each meal", goal: "", interventions: [], special_instructions: "" });
  }

  if (source.condition_pressure_injury === true) {
    items.push({ category: "skin_integrity", title: "Pressure injury care", description: `Stage 2, 3 or 4 pressure sore marked Yes on the ${exam}`, assistance_level: "limited_assist", frequency: "Each shift", goal: "Skin intact", interventions: [], special_instructions: "" });
    gaps.push({ title: "Pressure injury care", message: "Pressure injury care: confirm the support level and the wound-care orders." });
  }

  const services = form1823SectionText(source.service_requirements);
  const examiner = [source.physician_name?.trim(), source.examiner_title?.trim()].filter(Boolean);
  const noteLines = [
    `Drafted from ${exam}${examiner.length ? `, examiner ${examiner[0]}${examiner[1] ? ` (${examiner[1]})` : ""}` : ""}.`,
    source.allergies && source.allergies.length > 0 ? `Allergies: ${source.allergies.join(", ")}.` : "Allergies: none listed on the 1823.",
    services ? `Nursing / treatment / therapy per 1823: ${services}.` : "",
  ].filter(Boolean);

  return {
    items,
    notes: noteLines.join(" "),
    effectiveDate: options.today,
    reviewDueDate: addMonths(options.today, options.reviewMonths ?? DEFAULT_REVIEW_MONTHS),
    gaps,
  };
}
