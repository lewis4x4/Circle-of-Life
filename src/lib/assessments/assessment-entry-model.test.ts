import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_INSTRUMENT_HELD_ERROR,
  ASSESSMENT_SCHEDULE_BASIS_COPY,
  formatHeldInstrumentSaveError,
  heldInstrumentReason,
  isHeldInstrumentSaveError,
  isInstrumentHeld,
  computeCompletedResult,
  computeEntryProgress,
  computeProvisionalResult,
  formatDuplicateWarning,
  formatPoints,
  formatScheduleInterval,
  formatScoreOfMax,
  formatScoreRange,
  formatSectionsCompleted,
  formatSectionsRemaining,
  formatSwitchInstrumentWarning,
  pruneScoresToTemplate,
  sectionAnchorId,
} from "./assessment-entry-model";
import type { AssessmentTemplate, AssessmentTemplateItem, RiskThresholds } from "./types";

/**
 * The seeded instruments are the authority for what the form scores. Read
 * them from the migration that seeds `assessment_templates` so these tests
 * follow the real definitions rather than a hand-copied subset.
 */
function loadSeededTemplates(): Record<string, AssessmentTemplate> {
  const sql = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../supabase/migrations/012_assessment_templates.sql"),
    "utf8",
  );
  const blocks = sql.split(/INSERT INTO assessment_templates/).slice(1);
  const out: Record<string, AssessmentTemplate> = {};
  for (const block of blocks) {
    const type = /VALUES \(\s*'([a-z0-9_]+)'/.exec(block)?.[1];
    const name = /VALUES \(\s*'[a-z0-9_]+',\s*'([^']+)'/.exec(block)?.[1];
    const range = /'[^']*',\s*(\d+),\s*(\d+),\s*'(\{[^']*\})'::jsonb/.exec(block);
    const items = /\$([a-z0-9]+)\$(\[.*?\])\$\1\$::jsonb,\s*(\d+),/s.exec(block);
    if (!type || !name || !range || !items) throw new Error(`Could not parse seed block for ${type}`);
    out[type] = {
      id: `seed-${type}`,
      assessment_type: type,
      name,
      description: null,
      score_range_min: Number(range[1]),
      score_range_max: Number(range[2]),
      risk_thresholds: JSON.parse(range[3]) as RiskThresholds,
      items: JSON.parse(items[2]) as AssessmentTemplateItem[],
      default_frequency_days: Number(items[3]),
      required_role: [],
    };
  }
  return out;
}

const seeded = loadSeededTemplates();

/** Answer every item with the option at `pick(item)`. */
function answerAll(
  template: AssessmentTemplate,
  pick: (item: AssessmentTemplateItem, index: number) => number,
): Record<string, number> {
  const scores: Record<string, number> = {};
  template.items.forEach((item, index) => {
    scores[item.key] = pick(item, index);
  });
  return scores;
}

const min = (item: AssessmentTemplateItem) => Math.min(...item.options.map((o) => o.value));
const max = (item: AssessmentTemplateItem) => Math.max(...item.options.map((o) => o.value));

describe("seeded instrument definitions (provenance)", () => {
  it("seeds exactly the four instruments the page offers", () => {
    expect(Object.keys(seeded).sort()).toEqual(["braden", "katz_adl", "morse_fall", "phq9"]);
  });

  it("carries repeat intervals as template defaults, not facility configuration", () => {
    expect(seeded.katz_adl.default_frequency_days).toBe(90);
    expect(seeded.morse_fall.default_frequency_days).toBe(90);
    expect(seeded.braden.default_frequency_days).toBe(90);
    expect(seeded.phq9.default_frequency_days).toBe(180);
    expect(ASSESSMENT_SCHEDULE_BASIS_COPY).toBe("Haven default interval");
  });

  it("seeds labels only — no option definitions or item instructions yet", () => {
    for (const t of Object.values(seeded)) {
      for (const item of t.items) {
        expect(item.instructions ?? null).toBeNull();
        for (const opt of item.options) expect(opt.definition ?? null).toBeNull();
      }
    }
  });
});

describe("Braden Scale — spec 03 expected results", () => {
  const t = seeded.braden;

  it("has six subscales; friction & shear scores 1–3, the rest 1–4", () => {
    expect(t.items.map((i) => i.key)).toEqual([
      "sensory_perception",
      "moisture",
      "activity",
      "mobility",
      "nutrition",
      "friction_shear",
    ]);
    expect(t.items.map((i) => i.options.length)).toEqual([4, 4, 4, 4, 4, 3]);
    expect(t.score_range_min).toBe(6);
    expect(t.score_range_max).toBe(23);
  });

  it.each([
    [answerAll(t, min), 6, "very_high"],
    [{ ...answerAll(t, min), nutrition: 4 }, 9, "very_high"],
    [{ ...answerAll(t, min), nutrition: 4, activity: 2 }, 10, "high"],
    [{ ...answerAll(t, min), nutrition: 4, activity: 4 }, 12, "high"],
    [{ ...answerAll(t, min), nutrition: 4, activity: 4, moisture: 2 }, 13, "moderate"],
    [{ ...answerAll(t, min), nutrition: 4, activity: 4, moisture: 3 }, 14, "moderate"],
    [{ ...answerAll(t, min), nutrition: 4, activity: 4, moisture: 4 }, 15, "mild"],
    [{ ...answerAll(t, max), sensory_perception: 1, moisture: 2 }, 18, "mild"],
    [{ ...answerAll(t, max), sensory_perception: 1, moisture: 3 }, 19, "none"],
    [answerAll(t, max), 23, "none"],
  ])("scores %j as %i → %s", (scores, total, risk) => {
    expect(computeCompletedResult(t, scores)).toEqual({ totalScore: total, riskLevel: risk, scores });
  });
});

describe("Morse Fall Scale — spec 03 expected results", () => {
  const t = seeded.morse_fall;

  it("uses the Morse item weights", () => {
    const weights = Object.fromEntries(
      t.items.map((i) => [i.key, i.options.map((o) => o.value)]),
    );
    expect(weights).toEqual({
      history_of_falling: [0, 25],
      secondary_diagnosis: [0, 15],
      ambulatory_aid: [0, 15, 30],
      iv_heparin: [0, 20],
      gait: [0, 10, 20],
      mental_status: [0, 15],
    });
  });

  it.each([
    [answerAll(t, min), 0, "low"],
    [{ ...answerAll(t, min), secondary_diagnosis: 15 }, 15, "low"],
    [{ ...answerAll(t, min), history_of_falling: 25 }, 25, "standard"],
    [{ ...answerAll(t, min), secondary_diagnosis: 15, ambulatory_aid: 15, gait: 10 }, 40, "standard"],
    [{ ...answerAll(t, min), ambulatory_aid: 30, mental_status: 15 }, 45, "high"],
    [answerAll(t, max), 125, "high"],
  ])("scores %j as %i → %s", (scores, total, risk) => {
    expect(computeCompletedResult(t, scores)).toEqual({ totalScore: total, riskLevel: risk, scores });
  });
});

describe("Katz ADL — spec 03 expected results (0 = independent, 1 = dependent)", () => {
  const t = seeded.katz_adl;

  it.each([
    [answerAll(t, () => 0), 0, "level_1"],
    [{ ...answerAll(t, () => 0), bathing: 1, dressing: 1 }, 2, "level_1"],
    [{ ...answerAll(t, () => 0), bathing: 1, dressing: 1, toileting: 1 }, 3, "level_2"],
    [{ ...answerAll(t, () => 1), feeding: 0, continence: 0 }, 4, "level_2"],
    [{ ...answerAll(t, () => 1), feeding: 0 }, 5, "level_3"],
    [answerAll(t, () => 1), 6, "level_3"],
  ])("scores %j as %i → %s", (scores, total, risk) => {
    expect(computeCompletedResult(t, scores)).toEqual({ totalScore: total, riskLevel: risk, scores });
  });
});

describe("PHQ-9 — spec 03 expected results", () => {
  const t = seeded.phq9;

  it("has nine items scored 0–3", () => {
    expect(t.items).toHaveLength(9);
    for (const item of t.items) expect(item.options.map((o) => o.value)).toEqual([0, 1, 2, 3]);
  });

  const withTotal = (total: number) =>
    answerAll(t, (_item, index) => {
      // Fill 3s from the front until the total is reached.
      const filled = Math.min(3, Math.max(0, total - index * 3));
      return filled;
    });

  it.each([
    [0, "minimal"],
    [4, "minimal"],
    [5, "mild"],
    [9, "mild"],
    [10, "moderate"],
    [14, "moderate"],
    [15, "moderately_severe"],
    [19, "moderately_severe"],
    [20, "severe"],
    [27, "severe"],
  ])("total %i → %s", (total, risk) => {
    const scores = withTotal(total);
    expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBe(total);
    expect(computeCompletedResult(t, scores)?.riskLevel).toBe(risk);
  });
});

describe("incomplete answers never produce a result", () => {
  const t = seeded.braden;

  it("reports not_started with no answers", () => {
    expect(computeProvisionalResult(t, {})).toEqual({ state: "not_started", totalSections: 6 });
    expect(computeCompletedResult(t, {})).toBeNull();
  });

  it("reports in_progress, with no total and no risk, while any section is unanswered", () => {
    const partial = { sensory_perception: 1, moisture: 1, activity: 1 };
    const result = computeProvisionalResult(t, partial);
    expect(result).toEqual({ state: "in_progress", answeredSections: 3, totalSections: 6 });
    expect(result).not.toHaveProperty("totalScore");
    expect(result).not.toHaveProperty("riskLevel");
    expect(computeCompletedResult(t, partial)).toBeNull();
  });

  it("does not treat an unanswered section as zero", () => {
    const fiveOfSix = { ...answerAll(t, max) };
    delete fiveOfSix.friction_shear;
    expect(computeCompletedResult(t, fiveOfSix)).toBeNull();
  });

  it("names the first unanswered section for navigation", () => {
    const progress = computeEntryProgress(t, { sensory_perception: 2, activity: 3 });
    expect(progress.answeredSections).toBe(2);
    expect(progress.remainingSections).toBe(4);
    expect(progress.complete).toBe(false);
    expect(progress.firstUnansweredKey).toBe("moisture");
    expect(progress.sections[0]).toEqual({
      key: "sensory_perception",
      label: "Sensory Perception",
      position: 1,
      answered: true,
      selectedValue: 2,
      selectedLabel: "Very Limited",
    });
  });
});

describe("answers are pruned to the selected instrument", () => {
  it("drops keys that belong to another instrument", () => {
    const carried = { ...answerAll(seeded.katz_adl, () => 1), history_of_falling: 25 };
    expect(pruneScoresToTemplate(seeded.katz_adl, carried)).toEqual(answerAll(seeded.katz_adl, () => 1));
    expect(computeCompletedResult(seeded.katz_adl, carried)?.totalScore).toBe(6);
  });

  it("drops values that no option offers", () => {
    const t = seeded.braden;
    const tampered = { ...answerAll(t, max), friction_shear: 4 };
    expect(pruneScoresToTemplate(t, tampered)).not.toHaveProperty("friction_shear");
    expect(computeCompletedResult(t, tampered)).toBeNull();
  });

  it("keeps a real zero as an answer", () => {
    const t = seeded.morse_fall;
    const scores = answerAll(t, () => 0);
    expect(computeEntryProgress(t, scores).complete).toBe(true);
    expect(computeCompletedResult(t, scores)?.totalScore).toBe(0);
  });

  it("ignores non-numeric and NaN values", () => {
    const t = seeded.katz_adl;
    expect(pruneScoresToTemplate(t, { bathing: "1", dressing: Number.NaN, toileting: null })).toEqual({});
  });
});

describe("copy", () => {
  it("formats section progress", () => {
    expect(formatSectionsCompleted(0, 6)).toBe("0 of 6 sections completed");
    expect(formatSectionsCompleted(1, 1)).toBe("1 of 1 section completed");
    expect(formatSectionsRemaining(2)).toBe("2 sections remaining");
    expect(formatSectionsRemaining(1)).toBe("1 section remaining");
    expect(formatSectionsRemaining(0)).toBe("All sections answered");
  });

  it("formats intervals, ranges and points", () => {
    expect(formatScheduleInterval(90)).toBe("Every 90 days");
    expect(formatScheduleInterval(null)).toBe("Interval not set");
    expect(formatScoreRange(6, 23)).toBe("Score range 6–23");
    expect(formatScoreRange(null, 23)).toBe("Score range not set");
    expect(formatScoreOfMax(14, 23)).toBe("14 of 23");
    expect(formatScoreOfMax(14, null)).toBe("14");
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(25)).toBe("25 points");
    expect(sectionAnchorId("moisture")).toBe("assessment-section-moisture");
  });

  it("names the data-loss boundary when changing instruments", () => {
    expect(formatSwitchInstrumentWarning("Braden Scale", 1)).toContain("discards the 1 answer entered for Braden Scale");
    expect(formatSwitchInstrumentWarning("Braden Scale", 3)).toContain("3 answers");
  });

  it("names a same-day duplicate without implying replacement", () => {
    const copy = formatDuplicateWarning("Braden Scale", "2026-09-16", "Sample Resident");
    expect(copy).toContain("Braden Scale dated 2026-09-16 is already on record for Sample Resident");
    expect(copy).toContain("does not replace");
  });
});

describe("held instruments (COL-430)", () => {
  const available = { held_reason: null };
  const held = { held_reason: "PHQ-9 on hold until safety follow-up is added" };

  it("treats null, undefined and blank as available", () => {
    expect(isInstrumentHeld(available)).toBe(false);
    expect(isInstrumentHeld({})).toBe(false);
    expect(isInstrumentHeld({ held_reason: "   " })).toBe(false);
    expect(heldInstrumentReason(available)).toBeNull();
  });

  it("treats any real reason as held and returns it trimmed", () => {
    expect(isInstrumentHeld(held)).toBe(true);
    expect(heldInstrumentReason(held)).toBe("PHQ-9 on hold until safety follow-up is added");
    expect(heldInstrumentReason({ held_reason: "  on hold  " })).toBe("on hold");
  });

  it("recognises the database sentinel in a save error", () => {
    expect(isHeldInstrumentSaveError(ASSESSMENT_INSTRUMENT_HELD_ERROR)).toBe(true);
    // PostgREST wraps the message; matching must survive that.
    expect(isHeldInstrumentSaveError('new row violates: assessment_instrument_held')).toBe(true);
    expect(isHeldInstrumentSaveError("connection lost")).toBe(false);
    expect(isHeldInstrumentSaveError(null)).toBe(false);
  });

  it("names the instrument and says nothing was recorded", () => {
    expect(formatHeldInstrumentSaveError("PHQ-9")).toBe("PHQ-9 is on hold and was not recorded.");
  });

  it("keeps the seeded instruments available in the fixtures", () => {
    for (const t of Object.values(seeded)) expect(isInstrumentHeld(t)).toBe(false);
  });
});
