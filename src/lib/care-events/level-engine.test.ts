import { describe, expect, it } from "vitest";

import casesJson from "./level-cases.json";
import {
  CARE_EVENT_KINDS,
  deriveCareEvent,
  emptyCareEventFlags,
  isCareEventKind,
  type CareEventAnswers,
  type CareEventContext,
  type CareEventDerivation,
  type CareEventKind,
} from "./level-engine";
import {
  CARE_EVENT_CALL_911_LINE,
  careEventConsequenceLine,
  careEventSendButtonLabel,
  careEventShowsCall911Line,
} from "./level-copy";
import { CARE_EVENT_TILES, careEventTileByKind, careEventTileWord } from "./tiles";

type LevelCase = {
  id: string;
  kind: CareEventKind;
  answers: CareEventAnswers;
  context: CareEventContext;
  expect: CareEventDerivation;
};

const cases = casesJson as LevelCase[];

const FLAG_KEYS = [
  "ahca_reportable",
  "insurance_reportable",
  "dcf_report_required",
  "grievance_clock",
  "neuro_checks",
  "call_911_prompt",
  "photo_prompt",
  "emar_reminder",
] as const;

describe("level-cases.json", () => {
  it("has unique snake_case ids and at least 60 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, levelCase) => {
    const actual = deriveCareEvent(levelCase.kind, levelCase.answers, levelCase.context);
    expect(actual).toEqual(levelCase.expect);
  });
});

describe("deriveCareEvent", () => {
  it("throws on an unknown kind", () => {
    expect(() => deriveCareEvent("tornado", {}, {})).toThrow("Unknown care event kind: tornado");
  });

  it("always returns the eight flag keys", () => {
    for (const kind of CARE_EVENT_KINDS) {
      const { flags } = deriveCareEvent(kind, {}, {});
      expect(Object.keys(flags).sort()).toEqual([...FLAG_KEYS].sort());
    }
    expect(Object.keys(emptyCareEventFlags()).sort()).toEqual([...FLAG_KEYS].sort());
    expect(Object.values(emptyCareEventFlags()).every((v) => v === false)).toBe(true);
  });

  it("builds the contract section 7 example sentence", () => {
    const { sentence } = deriveCareEvent(
      "fall",
      { hurt: "a_little", head: "no", witnessed: "no", going_out: "no" },
      { location_label: "Resident Room", time_label: "10:05 PM" },
    );
    expect(sentence).toBe(
      "Found on the floor in the resident room at 10:05 PM. Not witnessed. Hurt a little. Did not hit head. Not going out. First aid given.",
    );
  });

  it("applies no rule for unknown answer values", () => {
    const unknown = deriveCareEvent(
      "fall",
      { hurt: "mystery", head: "maybe", going_out: "later" },
      { location_label: "Resident Room" },
    );
    const empty = deriveCareEvent("fall", {}, { location_label: "Resident Room" });
    expect(unknown).toEqual(empty);

    const signs = deriveCareEvent("condition_change", { signs: ["mystery", "confused"] }, {});
    expect(signs.derived_level).toBe(2);
    expect(signs.sentence).toBe("Not themselves. Signs: more confused than usual.");
  });

  it("defaults context when omitted", () => {
    expect(deriveCareEvent("wandering", { where: "found_inside" })).toEqual(
      deriveCareEvent("wandering", { where: "found_inside" }, {}),
    );
  });

  it("never reads the clock and never invents a time", () => {
    const { sentence } = deriveCareEvent("medication", { what: "refused" }, {});
    expect(sentence).toBe("Medicine. Refused.");
  });
});

describe("isCareEventKind", () => {
  it("accepts the eight kinds and rejects everything else", () => {
    for (const kind of CARE_EVENT_KINDS) expect(isCareEventKind(kind)).toBe(true);
    expect(isCareEventKind("incident")).toBe(false);
    expect(isCareEventKind(null)).toBe(false);
    expect(isCareEventKind(4)).toBe(false);
  });
});

describe("tiles", () => {
  it("covers all eight kinds in spec order", () => {
    expect(CARE_EVENT_TILES.map((t) => t.kind)).toEqual([...CARE_EVENT_KINDS]);
    expect(CARE_EVENT_TILES.map((t) => t.word)).toEqual([
      "Fall",
      "Hurt",
      "Sick or not themselves",
      "Upset or behavior",
      "Wandering or left",
      "Medicine",
      "Family or complaint",
      "Building or other",
    ]);
    expect(CARE_EVENT_TILES.filter((t) => t.residentOptional).map((t) => t.kind)).toEqual([
      "environment",
    ]);
    expect(careEventTileWord("injury_found")).toBe("Hurt");
    expect(careEventTileByKind("fall").questions.map((q) => q.key)).toEqual([
      "hurt",
      "head",
      "witnessed",
      "going_out",
    ]);
  });

  it("marks only the two multi-select questions as multi", () => {
    const multi = CARE_EVENT_TILES.flatMap((t) =>
      t.questions.filter((q) => q.multi).map((q) => `${t.kind}.${q.key}`),
    );
    expect(multi).toEqual(["injury_found.seen", "condition_change.signs"]);
  });

  it("every fixture answer is a registered option and every option appears in a fixture", () => {
    const registered = new Map<string, Set<string>>();
    const seenInFixtures = new Map<string, Set<string>>();
    for (const tile of CARE_EVENT_TILES) {
      for (const question of tile.questions) {
        const key = `${tile.kind}.${question.key}`;
        registered.set(key, new Set(question.options.map((o) => o.value)));
        seenInFixtures.set(key, new Set());
      }
    }

    for (const levelCase of cases) {
      for (const [answerKey, raw] of Object.entries(levelCase.answers)) {
        if (answerKey === "worried") {
          expect(typeof raw).toBe("boolean");
          continue;
        }
        const key = `${levelCase.kind}.${answerKey}`;
        const options = registered.get(key);
        expect(options, `${levelCase.id}: ${key} is not a question on this tile`).toBeDefined();
        const values = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
          expect(typeof value).toBe("string");
          expect(options?.has(value as string), `${levelCase.id}: ${key}=${String(value)}`).toBe(
            true,
          );
          seenInFixtures.get(key)?.add(value as string);
        }
      }
    }

    for (const [key, options] of registered) {
      const covered = seenInFixtures.get(key) ?? new Set<string>();
      const missing = [...options].filter((value) => !covered.has(value));
      expect(missing, `${key} options never exercised by a fixture`).toEqual([]);
    }
  });

  it("every tile appears in at least one fixture", () => {
    const kinds = new Set(cases.map((c) => c.kind));
    for (const tile of CARE_EVENT_TILES) expect(kinds.has(tile.kind)).toBe(true);
  });
});

describe("level copy", () => {
  it("names the send button and consequence by level", () => {
    expect(careEventSendButtonLabel(1)).toBe("Save to log");
    expect(careEventSendButtonLabel(2)).toBe("Save and alert the Administrator");
    expect(careEventSendButtonLabel(3)).toBe("Send urgent alert");
    expect(careEventSendButtonLabel(4)).toBe("Send emergency alert");
    for (const level of [1, 2, 3, 4] as const) {
      const line = careEventConsequenceLine(level);
      expect(line.endsWith(".")).toBe(true);
      expect(line.toLowerCase()).not.toContain("nurse");
    }
    expect(CARE_EVENT_CALL_911_LINE).toBe("Call 911 first if you have not. Then send.");
  });

  it("shows the 911 line only when the engine set call_911_prompt", () => {
    const fall = deriveCareEvent("fall", { hurt: "badly" }, {});
    expect(careEventShowsCall911Line("fall", fall.flags)).toBe(true);
    const medication = deriveCareEvent("medication", { what: "wrong", reaction: "yes" }, {});
    expect(careEventShowsCall911Line("medication", medication.flags)).toBe(false);
    expect(careEventShowsCall911Line("fall", emptyCareEventFlags())).toBe(false);
  });
});
