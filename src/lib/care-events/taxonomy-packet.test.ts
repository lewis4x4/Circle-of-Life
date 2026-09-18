import { describe, expect, it } from "vitest";

import { CARE_EVENT_KINDS } from "./level-engine";
import { CARE_EVENT_TILES } from "./tiles";
import {
  LEVEL_CASES,
  TAXONOMY_SIGN_OFF_ROWS,
  answerLabels,
  buildLevelEffects,
  buildTaxonomyPacket,
  categoryLabel,
  channelWords,
  flagLabel,
  offsetWords,
  paperReplacedByTile,
} from "./taxonomy-packet";

describe("the packet is generated, not written", () => {
  const sections = buildTaxonomyPacket();

  it("has one section per tile, in the caregiver's tile order", () => {
    expect(sections).toHaveLength(CARE_EVENT_TILES.length);
    expect(sections.map((section) => section.tile.kind)).toEqual(CARE_EVENT_TILES.map((tile) => tile.kind));
  });

  it("covers every tile the level engine knows about", () => {
    expect([...new Set(sections.map((section) => section.tile.kind))].sort()).toEqual([...CARE_EVENT_KINDS].sort());
  });

  it("includes every case in level-cases.json exactly once", () => {
    const printed = sections.flatMap((section) => section.cases.map((row) => row.id));
    expect(printed).toHaveLength(LEVEL_CASES.length);
    expect(new Set(printed).size).toBe(LEVEL_CASES.length);
    expect([...printed].sort()).toEqual(LEVEL_CASES.map((fixture) => fixture.id).sort());
  });

  it("leaves no tile without cases, so a signature covers the whole taxonomy", () => {
    for (const section of sections) {
      expect(section.cases.length, `${section.tile.kind} has no level cases`).toBeGreaterThan(0);
    }
  });

  it("prints a level word, never a raw level token", () => {
    const words = new Set(sections.flatMap((section) => section.cases.map((row) => row.levelWord)));
    for (const word of words) expect(["Note", "Heads-up", "Urgent", "Emergency"]).toContain(word);
    const serialised = JSON.stringify(sections);
    expect(serialised).not.toContain('"levelWord":"level_');
  });

  it("names the paper artefact each tile replaces", () => {
    for (const section of sections) {
      expect(section.paperReplaced.length).toBeGreaterThan(0);
      expect(section.paperReplaced).toBe(paperReplacedByTile(section.tile.kind));
    }
  });

  it("asks every question the tile asks, in the tile's order", () => {
    for (const section of sections) {
      expect(section.questions.map((question) => question.key)).toEqual(
        section.tile.questions.map((question) => question.key),
      );
    }
  });

  it("labels each answer with the button text the caregiver sees", () => {
    const fall = sections.find((section) => section.tile.kind === "fall")!;
    const firstCase = fall.cases[0]!;
    const hurt = firstCase.answers.find((answer) => answer.prompt === fall.tile.questions[0]!.prompt)!;
    expect(hurt.answer).not.toMatch(/_/);
  });

  it("marks a case the reporter's bump raised", () => {
    const bumped = sections.flatMap((section) => section.cases).filter((row) => row.bumped);
    const notBumped = sections.flatMap((section) => section.cases).filter((row) => !row.bumped);
    // The fixture file carries both kinds, so the column means something.
    expect(bumped.length).toBeGreaterThan(0);
    expect(notBumped.length).toBeGreaterThan(0);
  });

  it("names no person anywhere in the generated body", () => {
    const serialised = JSON.stringify(sections) + JSON.stringify(TAXONOMY_SIGN_OFF_ROWS);
    for (const name of ["Jessica", "Michelle", "Murphy", "Brian", "Darren", "Milton", "Kaye"]) {
      expect(serialised).not.toContain(name);
    }
  });
});

describe("the sign-off page", () => {
  it("has a row for the taxonomy and a row for paper and fax retirement", () => {
    expect(TAXONOMY_SIGN_OFF_ROWS).toHaveLength(2);
    expect(TAXONOMY_SIGN_OFF_ROWS[0]!.subject).toBe("Taxonomy and owner decisions D1 to D7");
    expect(TAXONOMY_SIGN_OFF_ROWS[1]!.subject).toBe("Paper and fax retirement");
  });

  it("says what retirement covers and what keeps running", () => {
    expect(TAXONOMY_SIGN_OFF_ROWS[1]!.detail).toContain("physician sheet print and fax continue");
  });
});

describe("what fires at each level", () => {
  const effects = buildLevelEffects({
    policies: [
      { level: "level_2", step: 0, after_minutes: 0, target_kind: "route", channels: ["in_app", "push"], ack_within_minutes: 30, route_name: "Administrator or Assistant" },
      { level: "level_2", step: 1, after_minutes: 30, target_kind: "on_call_primary", channels: ["sms"], ack_within_minutes: null, route_name: null },
      { level: "level_3", step: 0, after_minutes: 0, target_kind: "route", channels: ["in_app", "push", "sms"], ack_within_minutes: 10, route_name: "Administrator or Assistant" },
    ],
    protocols: [
      { kind: "fall", min_level: "level_2", task_type: "vitals_check", description: "Vital signs check", due_offset_minutes: 0, requires_flag: null },
      { kind: "any", min_level: "level_3", task_type: "witness_statement", description: "Witness statement", due_offset_minutes: 480, requires_flag: null },
    ],
  });

  it("covers all four levels in order", () => {
    expect(effects.map((row) => row.level)).toEqual([1, 2, 3, 4]);
    expect(effects.map((row) => row.word)).toEqual(["Note", "Heads-up", "Urgent", "Emergency"]);
  });

  it("interrupts nobody at Note", () => {
    expect(effects[0]!.steps).toHaveLength(0);
    expect(effects[0]!.ackWithinMinutes).toBeNull();
  });

  it("reads the acknowledgement window from the configuration row", () => {
    expect(effects[1]!.ackWithinMinutes).toBe(30);
    expect(effects[2]!.ackWithinMinutes).toBe(10);
  });

  it("names the route rather than a target code", () => {
    expect(effects[1]!.steps[0]!.target).toBe("Administrator or Assistant");
    expect(effects[1]!.steps[1]!.target).toBe("On-call primary");
  });

  it("carries a lower level's follow-ups up into the higher ones", () => {
    expect(effects[1]!.followups.map((task) => task.taskType)).toEqual(["vitals_check"]);
    expect(effects[2]!.followups.map((task) => task.taskType)).toEqual(["vitals_check", "witness_statement"]);
    expect(effects[3]!.followups.map((task) => task.taskType)).toEqual(["vitals_check", "witness_statement"]);
  });
});

describe("words an operator reads", () => {
  it("says timings the way a person says them", () => {
    expect(offsetWords(0)).toBe("immediately");
    expect(offsetWords(1)).toBe("in 1 minute");
    expect(offsetWords(30)).toBe("in 30 minutes");
    expect(offsetWords(60)).toBe("in 1 hour");
    expect(offsetWords(240)).toBe("in 4 hours");
    expect(offsetWords(1440)).toBe("in 1 day");
    expect(offsetWords(4320)).toBe("in 3 days");
  });

  it("says channels the way a person says them", () => {
    expect(channelWords(["in_app", "push", "sms", "voice"])).toBe("in-app, push, text, voice call");
  });

  it("never prints a raw category or flag token", () => {
    expect(categoryLabel("fall_with_injury")).toBe("Fall with injury");
    expect(flagLabel("ahca_reportable")).toBe("AHCA reportable");
    expect(flagLabel("something_new")).toBe("something new");
  });
});

describe("answerLabels", () => {
  it("says so when a fixture leaves a question unanswered", () => {
    const fall = CARE_EVENT_TILES.find((tile) => tile.kind === "fall")!;
    const labels = answerLabels(fall, {});
    expect(labels).toHaveLength(fall.questions.length);
    for (const label of labels) expect(label.answer).toBe("Not answered");
  });

  it("joins a multi-select answer", () => {
    const hurt = CARE_EVENT_TILES.find((tile) => tile.kind === "injury_found")!;
    const seen = hurt.questions.find((question) => question.multi)!;
    const labels = answerLabels(hurt, { [seen.key]: [seen.options[0]!.value, seen.options[1]!.value] });
    const row = labels.find((label) => label.prompt === seen.prompt)!;
    expect(row.answer).toBe(`${seen.options[0]!.label}, ${seen.options[1]!.label}`);
  });
});
