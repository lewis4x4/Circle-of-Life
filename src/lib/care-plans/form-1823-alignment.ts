/**
 * Does the active care plan answer what the Form 1823 says?
 *
 * For a standard ALF licence, survey does not ask for a care plan; it asks
 * for the 1823 and whether the services delivered match it. This compares
 * the resident's current 1823 with the active plan, need by need, and names
 * what is missing or weaker. Pure: the same rules as the draft mapping, read
 * in the other direction.
 */

import { formatCarePlanDateOnly } from "./care-plan-display-copy";
import type { Form1823DraftSource } from "./draft-from-form-1823";

export type AlignmentState = "addressed" | "weaker" | "not_addressed" | "not_assessed" | "no_plan";

export type AlignmentRow = {
  need: string;
  category: string;
  /** What the 1823 says, in words. */
  form1823: string;
  /** What the plan says, in words, or null when nothing matches. */
  plan: string | null;
  state: AlignmentState;
};

export type AlignmentPlanItem = {
  category: string | null;
  title: string | null;
  assistance_level: string | null;
};

export type AlignmentSummary = {
  addressed: number;
  weaker: number;
  notAddressed: number;
  notAssessed: number;
  /** True when the resident has no active plan at all. */
  noPlan: boolean;
};

const PLAN_RANK: Record<string, number> = {
  independent: 0,
  supervision: 1,
  limited_assist: 2,
  extensive_assist: 3,
  total_dependence: 4,
};

const PLAN_LABEL: Record<string, string> = {
  independent: "Independent",
  supervision: "Supervision",
  limited_assist: "Limited assist",
  extensive_assist: "Extensive assist",
  total_dependence: "Total dependence",
};

/** 1823 ADL value → the lowest plan rank that answers it, and its label. */
const ADL_EXPECTATION: Record<string, { minRank: number; label: string }> = {
  independent: { minRank: 0, label: "Independent" },
  supervision: { minRank: 1, label: "Needs supervision" },
  assistance: { minRank: 2, label: "Needs assistance" },
  dependent: { minRank: 4, label: "Total care" },
};

const ADL_NEEDS: Array<{ column: keyof Form1823DraftSource; category: string; need: string; titleHint: RegExp | null }> = [
  { column: "adl_walking", category: "mobility", need: "Ambulation", titleHint: /ambulat|walk/i },
  { column: "adl_transferring", category: "mobility", need: "Transferring", titleHint: /transfer/i },
  { column: "adl_bathing", category: "bathing", need: "Bathing", titleHint: null },
  { column: "adl_dressing", category: "dressing", need: "Dressing", titleHint: null },
  { column: "adl_grooming", category: "grooming", need: "Self-care (grooming)", titleHint: null },
  { column: "adl_toileting", category: "toileting", need: "Toileting", titleHint: null },
  { column: "adl_eating", category: "eating", need: "Eating", titleHint: null },
];

function planLabel(level: string | null | undefined): string {
  return (level && PLAN_LABEL[level]) || "No assistance level posted";
}

function findItem(items: AlignmentPlanItem[], category: string, titleHint: RegExp | null): AlignmentPlanItem | null {
  const inCategory = items.filter((item) => item.category === category);
  if (inCategory.length === 0) return null;
  if (titleHint) {
    const byTitle = inCategory.find((item) => titleHint.test(item.title ?? ""));
    if (byTitle) return byTitle;
    // A single generic mobility line covers both mobility needs; two specific lines do not.
    if (inCategory.length === 1 && !/ambulat|walk|transfer/i.test(inCategory[0].title ?? "")) return inCategory[0];
    return null;
  }
  return inCategory[0];
}

function strongest(items: AlignmentPlanItem[]): AlignmentPlanItem | null {
  return items.reduce<AlignmentPlanItem | null>((best, item) => {
    const rank = PLAN_RANK[item.assistance_level ?? ""] ?? -1;
    const bestRank = best ? PLAN_RANK[best.assistance_level ?? ""] ?? -1 : -1;
    return rank > bestRank ? item : best;
  }, null);
}

export function alignForm1823WithPlan(
  form: Form1823DraftSource,
  planItems: AlignmentPlanItem[] | null,
): { rows: AlignmentRow[]; summary: AlignmentSummary } {
  const rows: AlignmentRow[] = [];
  const items = planItems ?? [];
  const noPlan = planItems === null;

  const stateFor = (expectedMinRank: number, item: AlignmentPlanItem | null): AlignmentState => {
    if (noPlan) return "no_plan";
    if (!item) return "not_addressed";
    const rank = PLAN_RANK[item.assistance_level ?? ""];
    if (rank === undefined) return "not_addressed";
    return rank >= expectedMinRank ? "addressed" : "weaker";
  };

  for (const need of ADL_NEEDS) {
    const raw = form[need.column];
    const expectation = typeof raw === "string" ? ADL_EXPECTATION[raw] : undefined;
    const item = findItem(items, need.category, need.titleHint);
    if (!expectation) {
      rows.push({ need: need.need, category: need.category, form1823: "Not assessed on the 1823", plan: item ? planLabel(item.assistance_level) : null, state: "not_assessed" });
      continue;
    }
    if (!item && expectation.minRank === 0 && !noPlan) {
      // Independent on the 1823: nothing for staff to do, so no line is owed.
      rows.push({ need: need.need, category: need.category, form1823: expectation.label, plan: "No line needed", state: "addressed" });
      continue;
    }
    rows.push({ need: need.need, category: need.category, form1823: expectation.label, plan: item ? planLabel(item.assistance_level) : null, state: stateFor(expectation.minRank, item) });
  }

  const medItem = strongest(items.filter((item) => item.category === "medication_assistance"));
  switch (form.medication_assistance) {
    case "self_administered":
      rows.push({ need: "Medications", category: "medication_assistance", form1823: "Self-administers", plan: medItem ? planLabel(medItem.assistance_level) : "No medication line (none needed)", state: noPlan ? "no_plan" : "addressed" });
      break;
    case "assistance_with_self_administration":
      rows.push({ need: "Medications", category: "medication_assistance", form1823: "Needs assistance with self-administration (§2B)", plan: medItem ? planLabel(medItem.assistance_level) : null, state: stateFor(2, medItem) });
      break;
    case "administered_by_licensed_staff":
      rows.push({ need: "Medications", category: "medication_assistance", form1823: "Administered by licensed staff (§2B)", plan: medItem ? planLabel(medItem.assistance_level) : null, state: stateFor(3, medItem) });
      break;
    default:
      rows.push({ need: "Medications", category: "medication_assistance", form1823: "Not assessed on the 1823", plan: medItem ? planLabel(medItem.assistance_level) : null, state: "not_assessed" });
  }

  if (form.elopement_risk === true) {
    const item = items.find((i) => i.category === "behavioral" && /elope|wander/i.test(i.title ?? "")) ?? items.find((i) => i.category === "behavioral") ?? null;
    rows.push({ need: "Elopement precautions", category: "behavioral", form1823: "Elopement risk: Yes", plan: item ? item.title ?? "Behavioral line" : null, state: noPlan ? "no_plan" : item ? "addressed" : "not_addressed" });
  } else if (form.elopement_risk == null) {
    rows.push({ need: "Elopement precautions", category: "behavioral", form1823: "Not marked on the 1823", plan: null, state: "not_assessed" });
  }

  const cognitive = typeof form.cognitive_behavioral_status === "object" && form.cognitive_behavioral_status && Object.keys(form.cognitive_behavioral_status as object).length > 0;
  if (cognitive) {
    const item = items.find((i) => i.category === "cognitive") ?? null;
    rows.push({ need: "Cognitive / behavioral status", category: "cognitive", form1823: "Status recorded on the 1823", plan: item ? item.title ?? "Cognitive line" : null, state: noPlan ? "no_plan" : item ? "addressed" : "not_addressed" });
  }

  const diet = (form.prescribed_diet ?? "").trim();
  if (diet) {
    const item = items.find((i) => i.category === "dietary") ?? null;
    rows.push({ need: "Diet", category: "dietary", form1823: diet, plan: item ? item.title ?? "Dietary line" : null, state: noPlan ? "no_plan" : item ? "addressed" : "not_addressed" });
  }

  if (form.condition_pressure_injury === true) {
    const item = items.find((i) => i.category === "skin_integrity") ?? null;
    rows.push({ need: "Pressure injury care", category: "skin_integrity", form1823: "Stage 2–4 pressure sore: Yes", plan: item ? planLabel(item.assistance_level) : null, state: noPlan ? "no_plan" : item ? "addressed" : "not_addressed" });
  }

  const summary: AlignmentSummary = {
    addressed: rows.filter((r) => r.state === "addressed").length,
    weaker: rows.filter((r) => r.state === "weaker").length,
    notAddressed: rows.filter((r) => r.state === "not_addressed").length,
    notAssessed: rows.filter((r) => r.state === "not_assessed").length,
    noPlan,
  };
  return { rows, summary };
}

export const ALIGNMENT_STATE_LABELS: Record<AlignmentState, string> = {
  addressed: "Addressed",
  weaker: "Plan is weaker than the 1823",
  not_addressed: "Not addressed",
  not_assessed: "Not assessed on the 1823",
  no_plan: "No active plan",
};

/** Florida asks for a new 1823 every three years or on significant change. */
export const FORM_1823_MAX_AGE_YEARS = 3;

export function form1823AgeState(examDate: string | null, expirationDate: string | null, today: string): "current" | "expired" | "unknown" {
  if (expirationDate && expirationDate < today) return "expired";
  if (!examDate) return "unknown";
  const [y, m, d] = examDate.split("-").map(Number);
  if (!y || !m || !d) return "unknown";
  const limit = new Date(Date.UTC(y + FORM_1823_MAX_AGE_YEARS, m - 1, d)).toISOString().slice(0, 10);
  return limit < today ? "expired" : "current";
}

export function formatForm1823AgeLabel(examDate: string | null, expirationDate: string | null, today: string): string {
  const state = form1823AgeState(examDate, expirationDate, today);
  const exam = formatCarePlanDateOnly(examDate);
  if (state === "expired") return `Exam ${exam} — older than ${FORM_1823_MAX_AGE_YEARS} years or expired`;
  if (state === "unknown") return "Exam date not posted";
  return `Exam ${exam}`;
}
