import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  blankEscalationStep,
  draftsToLadder,
  ladderToDrafts,
  moveEscalationStep,
  removeEscalationStep,
} from "@/lib/operations/escalation-step-editor";
import { normalizeEscalationLadder } from "@/lib/operations/templates";

const stored = [
  { role: "facility_administrator", sla_minutes: 30, channel: "in_app", enabled: true },
  { role: "coo", sla_minutes: 120, channel: "sms", enabled: false },
];

describe("escalation step editor (COL-689)", () => {
  it("round-trips the stored ladder shape unchanged", () => {
    const back = draftsToLadder(ladderToDrafts(stored));
    expect(back).toEqual({ steps: stored });
    expect(normalizeEscalationLadder(JSON.stringify("steps" in back ? back.steps : []))).toEqual(stored);
  });

  it("names the first incomplete step in staff words", () => {
    expect(draftsToLadder([blankEscalationStep()])).toEqual({ error: "Step 1: choose who it escalates to." });
    expect(draftsToLadder([{ role: "coo", channel: "sms", sla_minutes: "1.5", enabled: true }])).toEqual({
      error: "Step 1: enter the minutes to wait as a whole number (0 or more).",
    });
    expect(draftsToLadder([])).toEqual({ steps: [] });
  });

  it("reorders and removes rows", () => {
    const drafts = ladderToDrafts(stored);
    expect(moveEscalationStep(drafts, 1, -1).map((d) => d.role)).toEqual(["coo", "facility_administrator"]);
    expect(moveEscalationStep(drafts, 0, -1).map((d) => d.role)).toEqual(["facility_administrator", "coo"]);
    expect(removeEscalationStep(drafts, 0).map((d) => d.role)).toEqual(["coo"]);
  });

  it("the templates page edits steps as rows, not a JSON textarea", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../app/(admin)/admin/operations/templates/page.tsx"),
      "utf8",
    );
    expect(source).toContain("<EscalationStepEditor");
    expect(source).not.toMatch(/escalation_ladder: event\.target\.value|Escalation ladder JSON|EMPTY_LADDER/);
  });
});
