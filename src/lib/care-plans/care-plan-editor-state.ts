/**
 * Care-plan editor state, derived from the resident's stored versions.
 *
 * The editor (`CarePlanAuthor`) and the resident care-plan page both read
 * from here so the heading, the status line, the action label and the
 * validation summary all describe the same verified state. Pure: no I/O.
 *
 * Versioning facts this encodes (migrations 321, 393, 396, 398):
 * - `create_care_plan_revision_review` inserts a *new* version in
 *   `under_review`; it never edits an existing row. There is no separate
 *   draft-save operation.
 * - The active version is archived by trigger only when the new version is
 *   approved. Drafting never touches it.
 * - A second revision cannot be saved while one is awaiting review.
 */

import { formatCarePlanDateOnly } from "./care-plan-display-copy";

export type CarePlanVersionSummary = {
  id: string;
  version: number | null;
  status: string | null;
  effective_date: string | null;
  review_due_date: string | null;
};

export type CarePlanEditorMode =
  /** No plan on file; saving creates version 1. */
  | "first"
  /** An active plan exists; saving creates the next version for review. */
  | "revision"
  /** A version is already awaiting clinical review; nothing more can be drafted. */
  | "pending";

export type CarePlanState<T extends CarePlanVersionSummary> = {
  mode: CarePlanEditorMode;
  /** The signed plan in force, if any. */
  active: T | null;
  /** The version awaiting clinical review (status draft or under_review), if any. */
  pending: T | null;
  /** Replaced versions, newest first. */
  archived: T[];
};

const PENDING_STATUSES = new Set(["draft", "under_review"]);

function byVersionDesc<T extends CarePlanVersionSummary>(a: T, b: T): number {
  return (b.version ?? 0) - (a.version ?? 0);
}

/** Read the resident's versions into the one state the page and editor agree on. */
export function describeCarePlanState<T extends CarePlanVersionSummary>(plans: readonly T[]): CarePlanState<T> {
  const sorted = [...plans].sort(byVersionDesc);
  const active = sorted.find((plan) => plan.status === "active") ?? null;
  const pending = sorted.find((plan) => PENDING_STATUSES.has(plan.status ?? "")) ?? null;
  const archived = sorted.filter((plan) => plan.status === "archived");
  const mode: CarePlanEditorMode = pending ? "pending" : active ? "revision" : "first";
  return { mode, active, pending, archived };
}

/** Operator label for a stored status. */
export function formatCarePlanStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Active";
    case "under_review":
      return "Awaiting clinical review";
    case "draft":
      return "Draft";
    case "archived":
      return "Replaced";
    default:
      return "No status posted";
  }
}

/** Sentence-case labels grounded in the `care_plan_items` columns. */
export const CARE_PLAN_FIELD_LABELS = {
  category: "Category",
  assistance_level: "Assistance level",
  title: "Need title",
  description: "Description of need",
  goal: "Goal",
  interventions: "Interventions",
  frequency: "Frequency",
  special_instructions: "Special instructions",
} as const;

export type CarePlanNeedField = keyof typeof CARE_PLAN_FIELD_LABELS;

/** What each field is for. No clinical examples; the nurse writes the content. */
export const CARE_PLAN_FIELD_HELP: Record<CarePlanNeedField, string> = {
  category: "The area of care this need belongs to.",
  assistance_level: "How much help the resident needs with this.",
  title: "A short name for the need, as it will print on the plan.",
  description: "What the need is and why it matters for this resident.",
  goal: "What the plan is trying to achieve for this need.",
  interventions: "What staff do to meet this need. One intervention per line.",
  frequency: "How often the interventions above are carried out.",
  special_instructions: "Anything staff must know before acting on this need. Prints as a high-priority protocol.",
};

export const CARE_PLAN_CATEGORY_LABELS: Record<string, string> = {
  mobility: "Mobility",
  bathing: "Bathing",
  dressing: "Dressing",
  grooming: "Grooming",
  toileting: "Toileting",
  eating: "Eating",
  medication_assistance: "Medication assistance",
  behavioral: "Behavioral",
  fall_prevention: "Fall prevention",
  skin_integrity: "Skin integrity",
  pain_management: "Pain management",
  cognitive: "Cognitive",
  social: "Social",
  dietary: "Dietary",
  other: "Other",
};

export const CARE_PLAN_ASSISTANCE_LABELS: Record<string, string> = {
  independent: "Independent",
  supervision: "Supervision",
  limited_assist: "Limited assist",
  extensive_assist: "Extensive assist",
  total_dependence: "Total dependence",
};

export function formatCarePlanCategory(value: string | null | undefined): string {
  if (!value) return "No category";
  return CARE_PLAN_CATEGORY_LABELS[value] ?? value.replace(/_/g, " ");
}

export function formatCarePlanAssistance(value: string | null | undefined): string {
  if (!value) return "No assistance level";
  return CARE_PLAN_ASSISTANCE_LABELS[value] ?? value.replace(/_/g, " ");
}

/** Copy the editor shows for each mode. */
export function carePlanEditorCopy(mode: CarePlanEditorMode, previous: CarePlanVersionSummary | null): {
  heading: string;
  intro: string;
  action: string;
  notesLabel: string;
  notesHelp: string;
} {
  if (mode === "revision" && previous) {
    const version = previous.version != null ? `v${previous.version}` : "the current version";
    return {
      heading: `Revise care plan (${version})`,
      intro: `Saving creates the next version and sends it for clinical review. ${
        version.charAt(0).toUpperCase() + version.slice(1)
      } stays in effect until a reviewer signs the new one.`,
      action: "Save for clinical review",
      notesLabel: "Reason for revision",
      notesHelp: "Why this version changes the plan. Prints with the plan as documentation notes.",
    };
  }
  return {
    heading: "New care plan",
    intro:
      "No plan is on file for this resident. Saving creates version 1 and sends it for clinical review; it takes effect once a reviewer signs it.",
    action: "Save for clinical review",
    notesLabel: "Notes",
    notesHelp: "Optional. Prints with the plan as documentation notes.",
  };
}

/** What the one save action does. Shown next to it so nobody guesses. */
export const CARE_PLAN_SAVE_MEANING_COPY =
  "Nothing is stored until you save. Saving creates a version awaiting clinical review; a reviewer signs it before it takes effect.";

export const CARE_PLAN_PENDING_REVIEW_COPY =
  "A version is awaiting clinical review. It must be signed before another revision can be drafted.";

export const CARE_PLAN_EFFECTIVE_DATE_HELP =
  "The date this version is meant to take effect. It becomes the plan of record only once signed.";

export const CARE_PLAN_REVIEW_DUE_HELP =
  "When this plan must next be reviewed. Haven records the date you enter and does not set an interval.";

export const CARE_PLAN_FORM_1823_RELATION_COPY =
  "Form 1823 informs the plan; it does not create one. Lines drafted from it are yours to change before saving.";

export type CarePlanDraftNeed = {
  /** `care_plan_items.id` of the line this was loaded from; absent for new lines. */
  sourceId?: string;
  category: string;
  title: string;
  description: string;
  assistance_level: string;
  frequency: string;
  goal: string;
  interventions: string[];
  special_instructions: string;
};

export type CarePlanDraft = {
  effective: string;
  review: string;
  notes: string;
  needs: CarePlanDraftNeed[];
};

export type CarePlanDraftIssue = {
  /** `plan` for dates, otherwise the index of the need. */
  scope: "plan" | number;
  field: "effective" | "review" | "needs" | CarePlanNeedField;
  message: string;
};

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** The RPC's requirements plus what a reviewer needs to read the line. */
export function validateCarePlanDraft(draft: CarePlanDraft): CarePlanDraftIssue[] {
  const issues: CarePlanDraftIssue[] = [];
  if (isBlank(draft.effective)) {
    issues.push({ scope: "plan", field: "effective", message: "Effective date is required." });
  }
  if (isBlank(draft.review)) {
    issues.push({ scope: "plan", field: "review", message: "Review due date is required." });
  } else if (!isBlank(draft.effective) && draft.review < draft.effective) {
    issues.push({ scope: "plan", field: "review", message: "Review due date cannot be before the effective date." });
  }
  if (draft.needs.length === 0) {
    issues.push({ scope: "plan", field: "needs", message: "Add at least one need." });
  }
  draft.needs.forEach((need, index) => {
    const label = `Need ${index + 1}`;
    if (isBlank(need.category)) issues.push({ scope: index, field: "category", message: `${label}: choose a category.` });
    if (isBlank(need.title)) issues.push({ scope: index, field: "title", message: `${label}: enter a need title.` });
    if (isBlank(need.description)) {
      issues.push({ scope: index, field: "description", message: `${label}: describe the need.` });
    }
    if (isBlank(need.assistance_level)) {
      issues.push({ scope: index, field: "assistance_level", message: `${label}: choose an assistance level.` });
    }
  });
  return issues;
}

/** One line for a collapsed need card. */
export function summarizeCarePlanNeed(need: CarePlanDraftNeed, index: number): string {
  const parts = [`Need ${index + 1}`];
  const title = need.title.trim();
  parts.push(title ? title : "Untitled");
  if (need.category) parts.push(formatCarePlanCategory(need.category));
  if (need.assistance_level) parts.push(formatCarePlanAssistance(need.assistance_level));
  return parts.join(" · ");
}

/** True when the line has nothing typed into it. */
export function isUntouchedCarePlanNeed(need: CarePlanDraftNeed): boolean {
  return (
    !need.sourceId &&
    isBlank(need.category) &&
    isBlank(need.title) &&
    isBlank(need.description) &&
    isBlank(need.assistance_level) &&
    isBlank(need.frequency) &&
    isBlank(need.goal) &&
    isBlank(need.special_instructions) &&
    need.interventions.every(isBlank)
  );
}

function needFingerprint(need: CarePlanDraftNeed): string {
  return JSON.stringify([
    need.category,
    need.title.trim(),
    need.description.trim(),
    need.assistance_level,
    need.frequency.trim(),
    need.goal.trim(),
    need.interventions.map((line) => line.trim()).filter(Boolean),
    need.special_instructions.trim(),
  ]);
}

export type CarePlanDraftChange = { kind: "added" | "modified" | "removed" | "unchanged"; label: string };

export type CarePlanDraftChangeSummary = {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
  rows: CarePlanDraftChange[];
  /** True when the dates, notes, or any need differ from what was loaded. */
  dirty: boolean;
};

/**
 * What this revision changes, against the lines it was loaded from. Lines are
 * matched by their source id so a renamed need reads as modified, not as one
 * removal plus one addition.
 */
export function summarizeCarePlanDraftChanges(
  loaded: readonly CarePlanDraftNeed[],
  draft: CarePlanDraft,
  loadedPlan: { effective: string; review: string; notes: string },
): CarePlanDraftChangeSummary {
  const loadedById = new Map<string, CarePlanDraftNeed>();
  for (const need of loaded) if (need.sourceId) loadedById.set(need.sourceId, need);
  const seen = new Set<string>();
  const rows: CarePlanDraftChange[] = [];
  let added = 0;
  let modified = 0;
  let unchanged = 0;
  draft.needs.forEach((need, index) => {
    const label = need.title.trim() || `Need ${index + 1}`;
    const original = need.sourceId ? loadedById.get(need.sourceId) : undefined;
    if (!original) {
      // A blank line nobody has typed into is not yet a change.
      if (isUntouchedCarePlanNeed(need)) return;
      added += 1;
      rows.push({ kind: "added", label });
      return;
    }
    seen.add(need.sourceId as string);
    if (needFingerprint(original) === needFingerprint(need)) {
      unchanged += 1;
      rows.push({ kind: "unchanged", label });
    } else {
      modified += 1;
      rows.push({ kind: "modified", label });
    }
  });
  let removed = 0;
  for (const [id, original] of loadedById) {
    if (seen.has(id)) continue;
    removed += 1;
    rows.push({ kind: "removed", label: original.title.trim() || "Untitled need" });
  }
  const planDirty =
    draft.effective !== loadedPlan.effective || draft.review !== loadedPlan.review || draft.notes !== loadedPlan.notes;
  return { added, modified, removed, unchanged, rows, dirty: planDirty || added + modified + removed > 0 };
}

export function formatCarePlanChangeSummary(summary: CarePlanDraftChangeSummary): string {
  const parts: string[] = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.modified) parts.push(`${summary.modified} changed`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (parts.length === 0) return "No needs changed yet";
  return parts.join(" · ");
}

export type CarePlanReviewDueSignal =
  | { kind: "none" }
  | { kind: "overdue"; days: number; label: string }
  | { kind: "dueToday"; label: string }
  | { kind: "approaching"; days: number; label: string }
  | { kind: "scheduled"; label: string };

function parseIsoDay(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  return Date.UTC(y, m - 1, d);
}

/**
 * The stored review date against today's calendar day. Same reading as the
 * Care plan reviews queue (past = overdue); 30 days matches the overview's
 * approaching window. Nothing here computes an interval.
 */
export function reviewDueSignal(reviewDueIso: string | null | undefined, todayIso: string): CarePlanReviewDueSignal {
  if (!reviewDueIso) return { kind: "none" };
  const due = parseIsoDay(reviewDueIso);
  const today = parseIsoDay(todayIso);
  if (Number.isNaN(due) || Number.isNaN(today)) return { kind: "none" };
  const days = Math.round((due - today) / 86_400_000);
  const dateLabel = formatCarePlanDateOnly(reviewDueIso);
  if (days < 0) {
    const overdue = Math.abs(days);
    return { kind: "overdue", days: overdue, label: `Review overdue by ${overdue} day${overdue === 1 ? "" : "s"} (${dateLabel})` };
  }
  if (days === 0) return { kind: "dueToday", label: `Review due today (${dateLabel})` };
  if (days <= 30) return { kind: "approaching", days, label: `Review due in ${days} day${days === 1 ? "" : "s"} (${dateLabel})` };
  return { kind: "scheduled", label: `Review due ${dateLabel}` };
}

/** Today's calendar day in the operator timezone, `yyyy-mm-dd`. */
export function easternTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
