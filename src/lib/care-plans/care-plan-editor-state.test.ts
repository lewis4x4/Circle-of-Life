import { describe, expect, it } from "vitest";

import {
  carePlanEditorCopy,
  describeCarePlanState,
  formatCarePlanChangeSummary,
  formatCarePlanStatusLabel,
  isUntouchedCarePlanNeed,
  reviewDueSignal,
  summarizeCarePlanDraftChanges,
  summarizeCarePlanNeed,
  validateCarePlanDraft,
  type CarePlanDraft,
  type CarePlanDraftNeed,
} from "./care-plan-editor-state";

const plan = (over: Partial<{ id: string; version: number; status: string }>) => ({
  id: over.id ?? `plan-${over.version ?? 1}`,
  version: over.version ?? 1,
  status: over.status ?? "active",
  effective_date: "2026-01-01",
  review_due_date: "2027-01-01",
});

const need = (over: Partial<CarePlanDraftNeed> = {}): CarePlanDraftNeed => ({
  category: "bathing",
  title: "Bathing",
  description: "Needs help in the shower",
  assistance_level: "limited_assist",
  frequency: "",
  goal: "",
  interventions: [],
  special_instructions: "",
  ...over,
});

describe("describeCarePlanState", () => {
  it("is a first plan when nothing non-archived exists", () => {
    expect(describeCarePlanState([]).mode).toBe("first");
    const state = describeCarePlanState([plan({ version: 1, status: "archived" })]);
    expect(state.mode).toBe("first");
    expect(state.archived).toHaveLength(1);
  });

  it("is a revision when an active plan exists and nothing is awaiting review", () => {
    const state = describeCarePlanState([plan({ version: 1, status: "archived" }), plan({ version: 2 })]);
    expect(state.mode).toBe("revision");
    expect(state.active?.version).toBe(2);
    expect(state.pending).toBeNull();
  });

  it("is pending when a draft or under_review version exists, with or without an active plan", () => {
    const withActive = describeCarePlanState([plan({ version: 1 }), plan({ version: 2, status: "under_review" })]);
    expect(withActive.mode).toBe("pending");
    expect(withActive.active?.version).toBe(1);
    expect(withActive.pending?.version).toBe(2);
    const firstAwaiting = describeCarePlanState([plan({ version: 1, status: "draft" })]);
    expect(firstAwaiting.mode).toBe("pending");
    expect(firstAwaiting.active).toBeNull();
  });
});

describe("carePlanEditorCopy", () => {
  it("names the version being revised and says it stays in effect", () => {
    const copy = carePlanEditorCopy("revision", plan({ version: 3 }));
    expect(copy.heading).toBe("Revise care plan (v3)");
    expect(copy.intro).toContain("V3 stays in effect");
    expect(copy.notesLabel).toBe("Reason for revision");
  });

  it("does not imply a signed plan for a first plan", () => {
    const copy = carePlanEditorCopy("first", null);
    expect(copy.heading).toBe("New care plan");
    expect(copy.intro).toContain("No plan is on file");
    expect(copy.intro).not.toMatch(/stays in effect/);
    expect(copy.notesLabel).toBe("Notes");
  });
});

describe("validateCarePlanDraft", () => {
  const base: CarePlanDraft = { effective: "2026-09-16", review: "2027-09-16", notes: "", needs: [need()] };

  it("passes a complete draft", () => {
    expect(validateCarePlanDraft(base)).toEqual([]);
  });

  it("requires both dates and rejects a review date before the effective date", () => {
    expect(validateCarePlanDraft({ ...base, effective: "", review: "" }).map((i) => i.field)).toEqual([
      "effective",
      "review",
    ]);
    const before = validateCarePlanDraft({ ...base, review: "2026-09-15" });
    expect(before).toHaveLength(1);
    expect(before[0].message).toMatch(/cannot be before/);
  });

  it("requires at least one need and names what each need is missing", () => {
    expect(validateCarePlanDraft({ ...base, needs: [] })[0].message).toBe("Add at least one need.");
    const issues = validateCarePlanDraft({
      ...base,
      needs: [need(), need({ category: "", title: " ", description: "", assistance_level: "" })],
    });
    expect(issues.map((i) => [i.scope, i.field])).toEqual([
      [1, "category"],
      [1, "title"],
      [1, "description"],
      [1, "assistance_level"],
    ]);
    expect(issues[0].message).toBe("Need 2: choose a category.");
  });
});

describe("need summaries", () => {
  it("summarises a need for its collapsed card", () => {
    expect(summarizeCarePlanNeed(need(), 0)).toBe("Need 1 · Bathing · Bathing · Limited assist");
    expect(summarizeCarePlanNeed(need({ title: "", category: "", assistance_level: "" }), 2)).toBe("Need 3 · Untitled");
  });

  it("knows an untouched blank line from a loaded or edited one", () => {
    expect(isUntouchedCarePlanNeed(need({ category: "", title: "", description: "", assistance_level: "" }))).toBe(true);
    expect(isUntouchedCarePlanNeed(need({ category: "", title: "", description: "", assistance_level: "", interventions: ["x"] }))).toBe(false);
    expect(isUntouchedCarePlanNeed(need({ sourceId: "i1", category: "", title: "", description: "", assistance_level: "" }))).toBe(false);
  });
});

describe("summarizeCarePlanDraftChanges", () => {
  const loadedPlan = { effective: "2026-01-01", review: "2027-01-01", notes: "" };
  const loaded = [need({ sourceId: "a", title: "Bathing" }), need({ sourceId: "b", title: "Dressing", category: "dressing" })];

  it("reports no change when the draft matches what was loaded", () => {
    const summary = summarizeCarePlanDraftChanges(loaded, { ...loadedPlan, needs: loaded }, loadedPlan);
    expect(summary.dirty).toBe(false);
    expect(formatCarePlanChangeSummary(summary)).toBe("No needs changed yet");
  });

  it("matches lines by source id so a renamed need is changed, not removed and added", () => {
    const draft: CarePlanDraft = {
      ...loadedPlan,
      needs: [need({ sourceId: "a", title: "Bathing and hair care" }), need({ title: "Mobility", category: "mobility" })],
    };
    const summary = summarizeCarePlanDraftChanges(loaded, draft, loadedPlan);
    expect(summary).toMatchObject({ added: 1, modified: 1, removed: 1, unchanged: 0, dirty: true });
    expect(summary.rows).toEqual([
      { kind: "modified", label: "Bathing and hair care" },
      { kind: "added", label: "Mobility" },
      { kind: "removed", label: "Dressing" },
    ]);
    expect(formatCarePlanChangeSummary(summary)).toBe("1 added · 1 changed · 1 removed");
  });

  it("does not count an untouched blank line as an addition", () => {
    const blank = need({ category: "", title: "", description: "", assistance_level: "" });
    const summary = summarizeCarePlanDraftChanges([], { effective: "", review: "", notes: "", needs: [blank] }, { effective: "", review: "", notes: "" });
    expect(summary).toMatchObject({ added: 0, dirty: false });
  });

  it("treats a changed date or note as dirty even with no need changes", () => {
    const summary = summarizeCarePlanDraftChanges(loaded, { ...loadedPlan, notes: "Fall on 9/1", needs: loaded }, loadedPlan);
    expect(summary.dirty).toBe(true);
    expect(summary.added + summary.modified + summary.removed).toBe(0);
  });
});

describe("reviewDueSignal", () => {
  it("reads the stored date against today without inventing an interval", () => {
    expect(reviewDueSignal(null, "2026-09-16")).toEqual({ kind: "none" });
    expect(reviewDueSignal("2026-09-01", "2026-09-16")).toMatchObject({ kind: "overdue", days: 15 });
    expect(reviewDueSignal("2026-09-16", "2026-09-16")).toMatchObject({ kind: "dueToday" });
    expect(reviewDueSignal("2026-09-17", "2026-09-16")).toMatchObject({ kind: "approaching", days: 1, label: "Review due in 1 day (Sep 17, 2026)" });
    expect(reviewDueSignal("2027-03-01", "2026-09-16")).toMatchObject({ kind: "scheduled", label: "Review due Mar 1, 2027" });
  });
});

describe("formatCarePlanStatusLabel", () => {
  it("uses operator words", () => {
    expect(formatCarePlanStatusLabel("under_review")).toBe("Awaiting clinical review");
    expect(formatCarePlanStatusLabel("archived")).toBe("Replaced");
    expect(formatCarePlanStatusLabel(null)).toBe("No status posted");
  });
});
